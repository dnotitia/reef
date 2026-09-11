// @vitest-environment node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AKB_REVISION,
  FAULT_KINDS,
  LIVE_SCENARIO,
  PASSWORD_ENV,
  buildDiscovery,
  buildReadyDescriptor,
  parseOptions,
} from "./live-notifications-runtime.mjs";

type BootstrapResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

async function findExecutable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching the original host PATH.
    }
  }
  throw new Error(`could not find host utility ${name}`);
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf8");
  await chmod(path, 0o755);
}

async function runBootstrap(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<BootstrapResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", [scriptPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stderr) {
      child.kill();
      reject(new Error("bootstrap test child streams were not piped"));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stderr, stdout }));
  });
}

async function linkHostUtilities(directory: string): Promise<void> {
  for (const name of ["awk", "cat", "dirname", "head", "sed", "tr", "uname"]) {
    await symlink(await findExecutable(name), join(directory, name));
  }

  for (const name of ["chmod", "mkdir", "rm"]) {
    const hostUtility = await findExecutable(name);
    const quotedHostUtility = `'${hostUtility.replaceAll("'", "'\\''")}'`;
    await writeExecutable(
      join(directory, name),
      `#!/bin/bash
set -eu
arguments=()
for argument in "$@"; do
  [[ "$argument" == "--" ]] && continue
  arguments+=("$argument")
done
exec ${quotedHostUtility} "\${arguments[@]}"
`,
    );
  }

  for (const name of ["apt-get", "curl", "sha256sum", "sudo", "tar", "xz"]) {
    await writeExecutable(join(directory, name), "#!/bin/bash\nexit 0\n");
  }
}

async function seedPrivateNode(
  runtimeRoot: string,
  nodeVersion: string,
  pnpmVersion: string,
  nodeArch: "arm64" | "x64",
): Promise<{ logPath: string; nodeBinDir: string }> {
  const nodeBinDir = join(
    runtimeRoot,
    "toolchain",
    `node-v${nodeVersion}-linux-${nodeArch}`,
    "bin",
  );
  const logPath = join(runtimeRoot, "bootstrap.log");
  await mkdir(nodeBinDir, { recursive: true });
  await writeExecutable(
    join(nodeBinDir, "node"),
    `#!/bin/bash
set -Eeuo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' 'v${nodeVersion}'
  exit 0
fi
if [[ "\${1:-}" == */npm ]]; then
  node_bin_dir="\${0%/*}"
  case ":\${PATH:-}:" in
    *:"\${node_bin_dir}":*) ;;
    *)
      echo "private Node was not on PATH before npm" >&2
      exit 91
      ;;
  esac
  prefix=""
  previous=""
  for argument in "$@"; do
    if [[ "$previous" == "--prefix" ]]; then
      prefix="$argument"
      break
    fi
    previous="$argument"
  done
  [[ -n "$prefix" ]] || { echo "npm prefix was not provided" >&2; exit 92; }
  mkdir -p "$prefix/bin"
  cat > "$prefix/bin/pnpm" <<'PNPM_SCRIPT'
#!/bin/bash
set -eu
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' '${pnpmVersion}'
  exit 0
fi
exit 0
PNPM_SCRIPT
  chmod +x "$prefix/bin/pnpm"
  printf 'npm-path=%s\\n' "\${PATH:-}" >> "\${BOOTSTRAP_TEST_LOG}"
  exit 0
fi
printf 'runtime-path=%s\\n' "\${PATH:-}" >> "\${BOOTSTRAP_TEST_LOG}"
printf '%s\\n' '{"status":"ready","marker":"bootstrap-test"}'
`,
  );
  await writeExecutable(
    join(nodeBinDir, "npm"),
    "#!/usr/bin/env node\n// The fake Node interpreter handles this fixture npm command.\n",
  );
  return { logPath, nodeBinDir };
}

describe("live notification runtime contract", () => {
  it("bootstraps the pinned Node/pnpm toolchain privately before publishing stdout", async () => {
    const bootstrap = await readFile(
      new URL(
        "../../../scripts/ci/live-notifications-bootstrap.sh",
        import.meta.url,
      ),
      "utf8",
    );

    expect(bootstrap).toContain("exec 3>&1 1>&2");
    expect(bootstrap).toContain(
      "tr -d '[:space:]' < \"$ROOT_DIR/.node-version\"",
    );
    expect(bootstrap).toContain('"packageManager"');
    expect(bootstrap).toContain("https://nodejs.org/dist/v${NODE_VERSION}");
    expect(bootstrap).toContain("SHASUMS256.txt");
    expect(bootstrap).toContain('PNPM_HOME="$TOOLCHAIN_ROOT/pnpm"');
    expect(bootstrap).not.toContain("/usr/local");
    expect(bootstrap).toContain(
      'export REEF_LIVE_NOTIFICATIONS_NODE_BIN="$NODE_BIN"',
    );
    expect(bootstrap).toContain(
      'exec "$NODE_BIN" "$ROOT_DIR/scripts/ci/live-notifications-runtime.mjs"',
    );
    expect(
      bootstrap.indexOf(
        'exec "$NODE_BIN" "$ROOT_DIR/scripts/ci/live-notifications-runtime.mjs"',
      ),
    ).toBeGreaterThan(
      bootstrap.indexOf('[[ "$($PNPM_BIN --version)" == "$PNPM_VERSION" ]]'),
    );
    expect(
      bootstrap.indexOf('export PATH="$(dirname "$NODE_BIN"):${PATH:-}"'),
    ).toBeLessThan(bootstrap.indexOf('"$NPM_BIN" install --global'));
  });

  it("executes npm with private Node on PATH when system Node is absent or mismatched", async () => {
    const repositoryRoot = new URL("../../../", import.meta.url).pathname;
    const nodeVersion = (
      await readFile(join(repositoryRoot, ".node-version"), "utf8")
    ).trim();
    const packageManifest = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as { packageManager?: string };
    const pnpmVersion = packageManifest.packageManager?.match(
      /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$/u,
    )?.[1];
    if (!pnpmVersion)
      throw new Error("test fixture could not read the pinned pnpm version");

    const nodeArch =
      process.arch === "arm64"
        ? "arm64"
        : process.arch === "x64"
          ? "x64"
          : undefined;
    if (!nodeArch)
      throw new Error(`unsupported test architecture: ${process.arch}`);

    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "reef-live-notifications-bootstrap-"),
    );
    try {
      const fixtureCi = join(fixtureRoot, "scripts", "ci");
      const fixtureBin = join(fixtureRoot, "bin");
      await mkdir(fixtureCi, { recursive: true });
      await mkdir(fixtureBin, { recursive: true });
      const bootstrapPath = join(fixtureCi, "live-notifications-bootstrap.sh");
      await copyFile(
        join(
          repositoryRoot,
          "scripts",
          "ci",
          "live-notifications-bootstrap.sh",
        ),
        bootstrapPath,
      );
      await chmod(bootstrapPath, 0o755);
      await writeFile(
        join(fixtureRoot, ".node-version"),
        `${nodeVersion}\n`,
        "utf8",
      );
      await writeFile(
        join(fixtureRoot, "package.json"),
        `{\n  "packageManager": "pnpm@${pnpmVersion}"\n}\n`,
        "utf8",
      );
      await writeFile(
        join(fixtureCi, "live-notifications-runtime.mjs"),
        "",
        "utf8",
      );
      await linkHostUtilities(fixtureBin);

      for (const [caseName, systemNodeMismatch] of [
        ["node-absent", false],
        ["node-mismatched", true],
      ] as const) {
        if (systemNodeMismatch) {
          await writeExecutable(
            join(fixtureBin, "node"),
            "#!/bin/bash\nprintf '%s\\n' 'v0.0.0'\n",
          );
          await writeExecutable(
            join(fixtureBin, "npm"),
            "#!/usr/bin/env node\n",
          );
        }

        const runtimeRoot = await mkdtemp(
          join(tmpdir(), `reef-live-notifications-runtime-${caseName}-`),
        );
        try {
          const { logPath, nodeBinDir } = await seedPrivateNode(
            runtimeRoot,
            nodeVersion,
            pnpmVersion,
            nodeArch,
          );
          const result = await runBootstrap(
            bootstrapPath,
            [
              "serve",
              "--scenario",
              LIVE_SCENARIO,
              "--runtime-root",
              runtimeRoot,
            ],
            {
              ...process.env,
              BOOTSTRAP_TEST_LOG: logPath,
              PATH: fixtureBin,
            },
          );

          expect(result.exitCode, `${caseName}: ${result.stderr}`).toBe(0);
          expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
            '{"status":"ready","marker":"bootstrap-test"}',
          ]);
          const resolvedNodeBinDir = await realpath(nodeBinDir);
          expect(await readFile(logPath, "utf8")).toContain(
            `npm-path=${resolvedNodeBinDir}:${fixtureBin}`,
          );
        } finally {
          await rm(runtimeRoot, { force: true, recursive: true });
        }
      }
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("accepts only the approved serve scenario and private paths", () => {
    expect(
      parseOptions(
        [
          "serve",
          "--scenario",
          LIVE_SCENARIO,
          "--runtime-root",
          "/tmp/reef-live-runtime",
          "--akb-checkout",
          "/tmp/akb-source",
        ],
        { NODE_ENV: "test" },
      ),
    ).toEqual({
      mode: "serve",
      scenario: LIVE_SCENARIO,
      runtimeRoot: "/tmp/reef-live-runtime",
      akbCheckout: "/tmp/akb-source",
    });
    expect(() =>
      parseOptions(["gate", "--scenario", LIVE_SCENARIO], {
        NODE_ENV: "test",
      }),
    ).toThrow(/usage/u);
    expect(() =>
      parseOptions(["serve", "--scenario", "notifications"], {
        NODE_ENV: "test",
      }),
    ).toThrow(/notifications-rbac/u);
  });

  it("publishes a schema-v2 descriptor for Reef, AKB, and fixture services", () => {
    const descriptor = buildReadyDescriptor({
      webOrigin: "http://127.0.0.1:41001",
      akbOrigin: "http://127.0.0.1:41002",
      fixtureOrigin: "http://127.0.0.1:41003",
      candidateRevision: "candidate-sha",
    });

    expect(descriptor).toMatchObject({
      schema_version: 2,
      status: "ready",
      scenario: LIVE_SCENARIO,
      services: {
        web: {
          health: { method: "GET", url: "http://127.0.0.1:41001/api/healthz" },
        },
        app: {
          health: { method: "GET", url: "http://127.0.0.1:41002/readyz" },
        },
        fixture: {
          reset: { method: "POST", body: { scenario: LIVE_SCENARIO } },
          discovery: { method: "GET", url: "http://127.0.0.1:41003/discover" },
        },
      },
      credentials: {
        password_env: PASSWORD_ENV,
        login_path: "/api/auth/akb/login",
      },
    });
    const serialized = JSON.stringify(descriptor);
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("session-token");
    expect(serialized).not.toContain("administrator-credential");
    expect(descriptor.evidence).toMatchObject({
      akb_source_revision: AKB_REVISION,
      candidate_revision: "candidate-sha",
    });
  });

  it("discovers real role coordinates and credential-free fault controls", () => {
    const discovery = buildDiscovery({
      vault: "reef-live-vault",
      webOrigin: "http://127.0.0.1:41001",
      fixtureOrigin: "http://127.0.0.1:41003",
      roles: {
        reader: "reef-live-reader",
        writer: "reef-live-writer",
        owner: "reef-live-owner",
      },
      permissionChecks: {
        reader_select: 200,
        reader_update: 403,
        writer_update: 200,
      },
      candidateRevision: "candidate-sha",
    });

    expect(discovery.roles.reader).toMatchObject({
      username: "reef-live-reader",
      role: "reader",
      start_path: "/workspace/reef-live-vault/inbox",
      login: {
        method: "POST",
        path: "/api/auth/akb/login",
        password_env: PASSWORD_ENV,
      },
    });
    expect(discovery.permission_checks).toEqual({
      reader_select: 200,
      reader_update: 403,
      writer_update: 200,
    });
    expect(discovery.controls.fault.kinds).toEqual([...FAULT_KINDS]);
    expect(discovery.observability).toMatchObject({
      method: "GET",
      path: "/observe",
      credential_free: true,
    });
    const serialized = JSON.stringify(discovery);
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("session-token");
    expect(serialized).not.toContain("akb_jwt");
  });
});
