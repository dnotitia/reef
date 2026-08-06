import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ProviderError } from "@reef/orchestrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  type LocalInfrastructureProvider,
  createLocalInfrastructureProvider,
} from "./index.js";

const execFileAsync = promisify(execFile);
const DEFAULT_ENVIRONMENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  VISIBLE_VALUE: "visible",
};

interface RepositoryFixture {
  readonly root: string;
  readonly workRoot: string;
  readonly outside: string;
  readonly firstCommit: string;
  readonly secondCommit: string;
  readonly branch: string;
  readonly initialStatus: string;
  readonly initialHead: string;
  readonly initialIndex: string;
  readonly initialTrackedContent: string;
  readonly initialUntrackedContent: string;
}

const git = async (root: string, args: readonly string[]): Promise<string> => {
  const result = await execFileAsync("git", [...args], {
    cwd: root,
    env: {
      PATH: DEFAULT_ENVIRONMENT.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: 256 * 1024,
  });
  return result.stdout.trim();
};

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;

const createRepository = async (): Promise<RepositoryFixture> => {
  const root = await mkdtemp(join(tmpdir(), "local-infrastructure-repo-"));
  const workRoot = join(dirname(root), `${basename(root)}-managed-worktrees`);
  const outside = join(root, "outside");
  await mkdir(workRoot);
  await mkdir(outside);
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Local Provider Test"]);
  await git(root, ["config", "user.email", "local-provider@example.test"]);
  await writeFile(join(root, "tracked.txt"), "first\n");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "--quiet", "-m", "first"]);
  const firstCommit = await git(root, ["rev-parse", "HEAD"]);
  await writeFile(join(root, "tracked.txt"), "second\n");
  await writeFile(join(root, "second.txt"), "second\n");
  await git(root, ["add", "tracked.txt", "second.txt"]);
  await git(root, ["commit", "--quiet", "-m", "second"]);
  const secondCommit = await git(root, ["rev-parse", "HEAD"]);
  const branch = await git(root, ["branch", "--show-current"]);

  await writeFile(join(root, "tracked.txt"), "primary-dirty\n");
  const initialUntrackedContent = "primary-untracked\n";
  await writeFile(join(root, "primary-untracked.txt"), initialUntrackedContent);

  return {
    root,
    workRoot,
    outside,
    firstCommit,
    secondCommit,
    branch,
    initialStatus: await git(root, ["status", "--porcelain=v1"]),
    initialHead: await git(root, ["rev-parse", "HEAD"]),
    initialIndex: await git(root, ["diff", "--cached", "--raw"]),
    initialTrackedContent: await readFile(join(root, "tracked.txt"), "utf8"),
    initialUntrackedContent,
  };
};

const expectProviderCode = async (
  operation: Promise<unknown> | unknown,
  code: ProviderError["code"],
): Promise<void> => {
  await expect(Promise.resolve(operation)).rejects.toMatchObject({
    name: "ProviderError",
    code,
  });
};

const worktreeDirectories = async (workRoot: string): Promise<string[]> => {
  const entries = await readdir(workRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

const createProvider = (
  fixture: RepositoryFixture,
  overrides: Partial<
    Parameters<typeof createLocalInfrastructureProvider>[0]
  > = {},
): LocalInfrastructureProvider =>
  createLocalInfrastructureProvider({
    target: "test-target",
    repositoryRoot: fixture.root,
    managedWorkRoot: fixture.workRoot,
    baseRevision: fixture.firstCommit,
    environment: DEFAULT_ENVIRONMENT,
    ...overrides,
  });

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local infrastructure provider", () => {
  it("provisions an exact detached worktree, bootstraps once, executes with bounded explicit output, syncs, and cleans only its worktree", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture.root, fixture.workRoot);
    let bootstrapCalls = 0;
    const provider = createProvider(fixture, {
      maxOutputBytes: 8,
      bootstrap: async ({ cwd, environment }) => {
        bootstrapCalls += 1;
        await mkdir(join(cwd, "nested"));
        await writeFile(join(cwd, "bootstrap.txt"), environment.VISIBLE_VALUE);
      },
    });

    const provisioned = await provider.provision({ target: "test-target" }, {});
    const resource = provisioned.resource;
    expect(resource.name).not.toContain(fixture.root);
    expect(resource.name).not.toContain(fixture.workRoot);
    expect(resource.uri).toBeUndefined();
    expect(bootstrapCalls).toBe(1);

    const [worktreeDirectory] = await worktreeDirectories(fixture.workRoot);
    expect(worktreeDirectory).toMatch(/^\.local-/u);
    const worktree = join(fixture.workRoot, worktreeDirectory);
    expect(await git(worktree, ["rev-parse", "HEAD"])).toBe(
      fixture.firstCommit,
    );
    expect(await git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "HEAD",
    );
    expect(await readFile(join(worktree, "bootstrap.txt"), "utf8")).toBe(
      "visible",
    );

    const executed = await provider.exec(
      {
        resource,
        command: `printf '%s|%s' "$VISIBLE_VALUE" "${"${LEAKED_VALUE-}"}"; printf 'stderr' >&2; printf '123456789'`,
        cwd: "nested",
      },
      {},
    );
    expect(executed.exitCode).toBe(0);
    expect(executed.stdout).toContain("visible|");
    expect(executed.stdout).not.toContain("secret");
    expect(executed.stderr).toBe("stderr");
    expect(executed.stdoutTruncated).toBe(true);
    expect(executed.stderrTruncated).toBe(false);

    const collected = await provider.collect({ resource }, {});
    expect(collected.stdout).toBe(executed.stdout);
    expect(collected.stderr).toBe(executed.stderr);
    expect(collected.artifacts).toEqual([]);

    const synced = await provider.sync(
      {
        resource,
        revision: fixture.secondCommit,
      },
      {},
    );
    expect(synced.revision).toBe(fixture.secondCommit);
    expect(await git(worktree, ["rev-parse", "HEAD"])).toBe(
      fixture.secondCommit,
    );
    expect(bootstrapCalls).toBe(1);

    const unrelated = join(
      dirname(fixture.root),
      `${basename(fixture.root)}-unrelated-worktree`,
    );
    fixtures.push(unrelated);
    await git(fixture.root, [
      "worktree",
      "add",
      "--detach",
      unrelated,
      fixture.firstCommit,
    ]);
    const cleaned = await provider.cleanup({ resource: synced.resource }, {});
    expect(cleaned).toEqual({ cleaned: true });
    expect(await stat(unrelated)).toBeTruthy();
    expect(await git(unrelated, ["rev-parse", "HEAD"])).toBe(
      fixture.firstCommit,
    );
    expect(await worktreeDirectories(fixture.workRoot)).toEqual([]);
    expect(await provider.cleanup({ resource: synced.resource }, {})).toEqual({
      cleaned: true,
    });

    expect(await git(fixture.root, ["status", "--porcelain=v1"])).toBe(
      fixture.initialStatus,
    );
    expect(await git(fixture.root, ["rev-parse", "HEAD"])).toBe(
      fixture.initialHead,
    );
    expect(await git(fixture.root, ["branch", "--show-current"])).toBe(
      fixture.branch,
    );
    expect(await git(fixture.root, ["diff", "--cached", "--raw"])).toBe(
      fixture.initialIndex,
    );
    expect(await readFile(join(fixture.root, "tracked.txt"), "utf8")).toBe(
      fixture.initialTrackedContent,
    );
    expect(
      await readFile(join(fixture.root, "primary-untracked.txt"), "utf8"),
    ).toBe(fixture.initialUntrackedContent);
  });

  it("rejects unknown targets, forged references, invalid cwd paths, and symlink escapes before executing", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture.root, fixture.workRoot);
    const provider = createProvider(fixture);

    await expectProviderCode(
      provider.provision({ target: "other-target" }, {}),
      "request",
    );
    expect(await worktreeDirectories(fixture.workRoot)).toEqual([]);

    const { resource } = await provider.provision(
      { target: "test-target" },
      {},
    );
    await expectProviderCode(
      provider.exec(
        { resource, command: "printf should-not-run", cwd: "/tmp" },
        {},
      ),
      "request",
    );
    await expectProviderCode(
      provider.exec(
        { resource, command: "printf should-not-run", cwd: ".." },
        {},
      ),
      "request",
    );
    await expectProviderCode(
      provider.exec(
        {
          resource: { name: resource.name, revision: "0" },
          command: "printf should-not-run",
        },
        {},
      ),
      "request",
    );

    const [directory] = await worktreeDirectories(fixture.workRoot);
    const worktree = join(fixture.workRoot, directory);
    await symlink(fixture.outside, join(worktree, "escape"));
    await expectProviderCode(
      provider.exec(
        { resource, command: "printf should-not-run", cwd: "escape" },
        {},
      ),
      "request",
    );
    await provider.cleanup({ resource }, {});
  });

  it("does not inherit ambient secrets and cancels the process group before cleanup", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture.root, fixture.workRoot);
    const provider = createProvider(fixture, {
      environment: DEFAULT_ENVIRONMENT,
      terminationTimeoutMs: 100,
    });
    const { resource } = await provider.provision(
      { target: "test-target" },
      {},
    );

    const controller = new AbortController();
    const childPidFile = "child.pid";
    const childScript =
      "const fs = require('node:fs'); const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); fs.writeFileSync('child.pid', String(child.pid)); setInterval(() => {}, 1000);";
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(childScript)}`;
    const [directory] = await worktreeDirectories(fixture.workRoot);
    const worktree = join(fixture.workRoot, directory);
    const childPidPath = join(worktree, childPidFile);
    const execution = provider.exec(
      { resource, command },
      { signal: controller.signal },
    );
    const pidDeadline = Date.now() + 2_000;
    while (Date.now() < pidDeadline) {
      try {
        await stat(childPidPath);
        break;
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
    controller.abort();
    await expectProviderCode(execution, "cancelled");

    const childPid = Number(await readFile(childPidPath, "utf8"));
    expect(Number.isInteger(childPid)).toBe(true);
    await provider.cleanup(
      { resource: { name: resource.name, revision: resource.revision } },
      {},
    );
    await expectProviderCode(
      provider.exec({ resource, command: "printf should-not-run" }, {}),
      "request",
    );
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      try {
        process.kill(childPid, 0);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      } catch {
        break;
      }
    }
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it("cleans a failed bootstrap and rejects pre-aborted provision without creating a worktree", async () => {
    const fixture = await createRepository();
    fixtures.push(fixture.root, fixture.workRoot);
    const failedProvider = createProvider(fixture, {
      bootstrap: () => {
        throw new Error("bootstrap failed");
      },
    });
    await expectProviderCode(
      failedProvider.provision({ target: "test-target" }, {}),
      "protocol",
    );
    expect(await worktreeDirectories(fixture.workRoot)).toEqual([]);

    const abortedController = new AbortController();
    abortedController.abort();
    const abortedProvider = createProvider(fixture, {
      managedWorkRoot: join(fixture.root, "aborted-managed"),
    });
    await expectProviderCode(
      abortedProvider.provision(
        { target: "test-target" },
        { signal: abortedController.signal },
      ),
      "cancelled",
    );
    await expect(
      stat(join(fixture.root, "aborted-managed")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
