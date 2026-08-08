import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeScript = join(repositoryRoot, "scripts", "test-runtime.sh");

function run(args, env = {}) {
  return spawnSync("bash", [runtimeScript, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("declares the repository-owned validation runtime catalog", () => {
  const result = run(["describe"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^full-e2e lifecycle=oneshot /mu);
  assert.match(result.stdout, /^web-behavior lifecycle=runtime /mu);
  assert.match(result.stdout, /test:e2e:sharded/u);
  assert.match(result.stdout, /dev:e2e/u);
});

test("rejects an unmapped runtime name before provisioning", () => {
  const result = run(["unknown-runtime"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: scripts\/test-runtime\.sh/u);
});

test("bootstraps the pinned Node archive and invokes the canonical full E2E lane", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "reef-test-runtime-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requiredNode = (
    await readFile(join(repositoryRoot, ".node-version"), "utf8")
  ).trim();
  const nodePlatform = platform() === "darwin" ? "darwin" : "linux";
  const nodeArch = arch() === "arm64" ? "arm64" : "x64";
  const distribution = `node-v${requiredNode}-${nodePlatform}-${nodeArch}`;
  const fixtureRoot = join(root, "fixture");
  const distributionRoot = join(fixtureRoot, distribution);
  const fakeBin = join(root, "bin");
  const archive = join(root, `${distribution}.tar.gz`);
  const checksums = join(root, "SHASUMS256.txt");
  const invocationLog = join(root, "pnpm.log");
  await mkdir(join(distributionRoot, "bin"), { recursive: true });
  await mkdir(fakeBin);
  await writeFile(
    join(distributionRoot, "bin", "node"),
    `#!/usr/bin/env bash\nprintf 'v%s\\n' ${requiredNode}\n`,
  );
  await writeFile(
    join(distributionRoot, "bin", "corepack"),
    `#!/usr/bin/env bash
set -eu
install_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--install-directory" ]; then install_dir="$2"; shift 2; else shift; fi
done
mkdir -p "$install_dir"
cat > "$install_dir/pnpm" <<'PNPM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_RUNTIME_LOG"
PNPM
chmod 755 "$install_dir/pnpm"
`,
  );
  await chmod(join(distributionRoot, "bin", "node"), 0o755);
  await chmod(join(distributionRoot, "bin", "corepack"), 0o755);
  const tarResult = spawnSync("tar", ["-czf", archive, distribution], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
  assert.equal(tarResult.status, 0, tarResult.stderr);
  const checksum = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(checksums, `${checksum}  ${distribution}.tar.gz\n`);
  await writeFile(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
set -eu
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  */SHASUMS256.txt) cp "$TEST_RUNTIME_CHECKSUMS" "$output" ;;
  *) cp "$TEST_RUNTIME_ARCHIVE" "$output" ;;
esac
`,
  );
  await chmod(join(fakeBin, "curl"), 0o755);

  const result = run(["full-e2e"], {
    PATH: `${fakeBin}:${process.env.PATH}`,
    XDG_CACHE_HOME: join(root, "cache"),
    TEST_RUNTIME_ARCHIVE: archive,
    TEST_RUNTIME_CHECKSUMS: checksums,
    TEST_RUNTIME_LOG: invocationLog,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(invocationLog, "utf8")).trim().split("\n"), [
    "install --frozen-lockfile",
    "--filter @reef/web run test:e2e:sharded",
  ]);
});
