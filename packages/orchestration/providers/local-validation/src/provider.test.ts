import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ProviderError } from "@reef/orchestrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_VALIDATION_PROVIDER_ID,
  LOCAL_VALIDATION_PROVIDER_VERSION,
  createLocalValidationProvider,
} from "./index.js";

const execFileAsync = promisify(execFile);
const TEST_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
const TEST_ENVIRONMENT = Object.freeze({
  PATH: TEST_PATH,
  VALIDATION_SECRET: "validation-secret-value",
});

interface RepositoryFixture {
  readonly root: string;
  readonly revision: string;
}

const temporaryPaths: string[] = [];

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await execFileAsync("git", [...args], {
    cwd,
    env: {
      PATH: TEST_PATH,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: 256 * 1024,
  });
  return result.stdout.trim();
};

const createRepository = async (): Promise<RepositoryFixture> => {
  const root = await mkdtemp(join(tmpdir(), "validation-provider-repository-"));
  temporaryPaths.push(root);
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Validation Provider Test"]);
  await git(root, ["config", "user.email", "validation-provider@example.test"]);
  await writeFile(join(root, "tracked.txt"), "clean\n");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "--quiet", "-m", "initial"]);
  return { root, revision: await git(root, ["rev-parse", "HEAD"]) };
};

const createProvider = (
  repository: RepositoryFixture,
  overrides: Partial<Parameters<typeof createLocalValidationProvider>[0]> = {},
) =>
  createLocalValidationProvider({
    repositoryRoot: repository.root,
    environment: TEST_ENVIRONMENT,
    ...overrides,
  });

const check = (name: string, command: string, timeoutMs = 2_000) => ({
  name,
  command,
  timeoutMs,
});

const request = (
  repository: RepositoryFixture,
  checks: ReturnType<typeof check>[],
) => ({
  candidateRevision: repository.revision,
  contractRevision: "contract-revision",
  checks,
});

const expectProviderCode = async (
  operation: Promise<unknown>,
  code: ProviderError["code"],
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({
    name: "ProviderError",
    code,
    providerKind: "validation",
    providerId: LOCAL_VALIDATION_PROVIDER_ID,
    operation: "validate",
  });
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("condition did not become true");
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local validation provider", () => {
  it("exports a stable validation identity and returns ordered passing proof", async () => {
    const repository = await createRepository();
    const provider = createProvider(repository);

    expect(provider).toMatchObject({
      kind: "validation",
      id: LOCAL_VALIDATION_PROVIDER_ID,
      version: LOCAL_VALIDATION_PROVIDER_VERSION,
      capabilities: ["validate"],
    });

    const proof = await provider.validate(
      request(repository, [
        check("first", "printf first"),
        check("second", "printf second"),
      ]),
      {},
    );

    expect(proof.status).toBe("passed");
    expect(proof.candidateRevision).toBe(repository.revision);
    expect(proof.contractRevision).toBe("contract-revision");
    expect(proof.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(proof.checks.map((item) => item.name)).toEqual(["first", "second"]);
    expect(proof.checks.map((item) => item.status)).toEqual([
      "passed",
      "passed",
    ]);
    expect(proof.checks[0]).toMatchObject({
      exitCode: 0,
      excerpt: {
        stdout: "first",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    });
  });

  it("fails fast with bounded redacted evidence and skipped remaining checks", async () => {
    const repository = await createRepository();
    const provider = createProvider(repository, { maxOutputBytes: 16 });

    const proof = await provider.validate(
      request(repository, [
        check(
          "failing-check",
          "printf '%s' \"$VALIDATION_SECRET\"; printf 'stderr-output-that-is-long' >&2; exit 7",
        ),
        check("must-be-skipped", "printf should-not-run"),
      ]),
      {},
    );

    expect(proof.status).toBe("failed");
    expect(proof.checks[0]).toMatchObject({
      status: "failed",
      exitCode: 7,
      excerpt: {
        stdout: "[REDACTED]",
        stderr: "stderr-output-th",
        stdoutTruncated: false,
        stderrTruncated: true,
      },
    });
    expect(proof.checks[1]).toMatchObject({
      status: "skipped",
      durationMs: 0,
      exitCode: null,
    });
    const serialized = JSON.stringify(proof);
    expect(serialized).not.toContain("validation-secret-value");
    expect(serialized).not.toContain(repository.root);
    expect(serialized).not.toContain("should-not-run");
  });

  it("returns a timed-out check and leaves no process-tree descendant", async () => {
    const repository = await createRepository();
    const pidFile = join(repository.root, "descendant.pid");
    const descendantScript =
      "const {setInterval}=require('node:timers'); setInterval(()=>{},1000);";
    const parentScript = [
      "const {spawn}=require('node:child_process');",
      "const {writeFileSync}=require('node:fs');",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:'ignore'});`,
      `writeFileSync(${JSON.stringify(pidFile)},String(child.pid));`,
      "setInterval(()=>{},1000);",
    ].join("");
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`;
    const provider = createProvider(repository, { terminationTimeoutMs: 250 });

    const proof = await provider.validate(
      request(repository, [check("timeout", command, 500)]),
      {},
    );

    expect(proof.status).toBe("failed");
    expect(proof.checks[0].status).toBe("timed_out");
    await waitFor(async () => {
      try {
        const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
        return !processExists(pid);
      } catch {
        return false;
      }
    });
  });

  it("distinguishes pre-abort and mid-run cancellation", async () => {
    const repository = await createRepository();
    const provider = createProvider(repository);
    const preAborted = new AbortController();
    preAborted.abort();

    await expectProviderCode(
      provider.validate(request(repository, [check("pre-abort", "sleep 1")]), {
        signal: preAborted.signal,
      }),
      "cancelled",
    );

    const running = new AbortController();
    const operation = provider.validate(
      request(repository, [check("mid-run", "sleep 10", 10_000)]),
      { signal: running.signal },
    );
    setTimeout(() => running.abort(), 200);
    await expectProviderCode(operation, "cancelled");
  });

  it("rejects candidate, dirty-worktree, symlink, and concurrent drift before validation commands", async () => {
    const repository = await createRepository();
    const provider = createProvider(repository);
    const marker = join(repository.root, "marker.txt");

    await expectProviderCode(
      provider.validate(
        {
          ...request(repository, [
            check("wrong", `touch ${shellQuote(marker)}`),
          ]),
          candidateRevision: "0".repeat(40),
        },
        {},
      ),
      "request",
    );
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(join(repository.root, "dirty.txt"), "dirty\n");
    await expectProviderCode(
      provider.validate(request(repository, [check("dirty", "true")]), {}),
      "request",
    );
    await rm(join(repository.root, "dirty.txt"));

    const symlinkRoot = join(
      repository.root,
      "..",
      `${basename(repository.root)}-link`,
    );
    await symlink(repository.root, symlinkRoot);
    temporaryPaths.push(symlinkRoot);
    await expectProviderCode(
      createProvider(repository, { repositoryRoot: symlinkRoot }).validate(
        request(repository, [check("symlink", "true")]),
        {},
      ),
      "request",
    );

    const first = provider.validate(
      request(repository, [check("long", "sleep 0.2")]),
      {},
    );
    await expectProviderCode(
      provider.validate(request(repository, [check("concurrent", "true")]), {}),
      "request",
    );
    await first;
  });
});
