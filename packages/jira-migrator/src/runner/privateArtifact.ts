import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { lock } from "proper-lockfile";
import { z } from "zod";
import { canonicalizeJson } from "../archive/canonicalJson.js";

const execFileAsync = promisify(execFile);

const PrivatePlanArtifactSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: z.string().min(1),
    source: z
      .object({
        jira_cloud_id: z.string().min(1),
        project_keys: z.array(z.string().min(1)).min(1),
        board_ids: z.array(z.string().min(1)),
        endpoint_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    target: z
      .object({
        vault: z.string().min(1),
        actor: z.string().min(1),
        endpoint_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    plan_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    approval_report_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    payload: z.unknown(),
  })
  .strict();

export type PrivatePlanArtifact = z.infer<typeof PrivatePlanArtifactSchema>;

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

export const assertNoSymlinkPathComponents = async (
  path: string,
): Promise<void> => {
  if (path.split(/[\\/]/u).includes("..")) {
    throw new Error("private_artifact_parent_segment");
  }
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  let current = root;
  for (const segment of absolute
    .slice(root.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error("private_artifact_symlink");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
};

const assertPrivate = async (
  path: string,
  kind: "file" | "directory",
): Promise<void> => {
  if (process.platform === "win32") {
    throw new Error("private_artifact_acl_verification_unsupported");
  }
  await assertNoSymlinkPathComponents(path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error("private_artifact_symlink");
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error("private_artifact_type");
  }
  if ((stat.mode & 0o777) !== (kind === "file" ? 0o600 : 0o700)) {
    throw new Error("private_artifact_permission");
  }
};

const ensureDirectory = async (path: string): Promise<void> => {
  await assertNoSymlinkPathComponents(path);
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
  await assertPrivate(path, "directory");
};

const parse = (raw: string): PrivatePlanArtifact => {
  const parsed = PrivatePlanArtifactSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("private_plan_artifact_invalid");
  return parsed.data;
};

export async function readPrivatePlanArtifact(
  path: string,
): Promise<PrivatePlanArtifact> {
  const absolute = resolve(path);
  await assertPrivate(dirname(absolute), "directory");
  await assertPrivate(absolute, "file");
  return parse(await readFile(absolute, "utf8"));
}

export async function writePrivatePlanArtifact(
  path: string,
  artifact: PrivatePlanArtifact,
): Promise<void> {
  const parsed = PrivatePlanArtifactSchema.parse(artifact);
  const absolute = resolve(path);
  const directory = dirname(absolute);
  await ensureDirectory(directory);
  if (await exists(absolute)) {
    const current = await readPrivatePlanArtifact(absolute);
    if (canonicalizeJson(current) !== canonicalizeJson(parsed)) {
      throw new Error("private_plan_artifact_immutable");
    }
    return;
  }
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(canonicalizeJson(parsed), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    try {
      await link(temporary, absolute);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const winner = await readPrivatePlanArtifact(absolute);
      if (canonicalizeJson(winner) !== canonicalizeJson(parsed)) {
        throw new Error("private_plan_artifact_immutable");
      }
      return;
    }
    await assertPrivate(absolute, "file");
    const readback = await readPrivatePlanArtifact(absolute);
    if (canonicalizeJson(readback) !== canonicalizeJson(parsed)) {
      throw new Error("private_plan_artifact_readback");
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function acquireMigrationRunLock(
  path: string,
): Promise<() => Promise<void>> {
  const absolute = resolve(path);
  const ownerPath = `${absolute}/owner.json`;
  await ensureDirectory(dirname(absolute));
  const processIdentity = async (pid: number): Promise<string | null> => {
    if (process.platform === "linux") {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        const closeParen = stat.lastIndexOf(")");
        const fields = stat.slice(closeParen + 2).split(" ");
        const startedAt = fields[19];
        if (startedAt) return `linux:${pid}:${startedAt}`;
      } catch {
        // Fall through to the portable liveness fallback.
      }
    }
    try {
      const { stdout } =
        process.platform === "win32"
          ? await execFileAsync("powershell.exe", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
            ])
          : await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
              env: {
                PATH: process.env.PATH ?? "/usr/bin:/bin",
                LC_ALL: "C",
                LANG: "C",
                TZ: "UTC",
              },
            });
      const identity = stdout.trim();
      if (identity.length > 0) {
        return `${process.platform}:${pid}:${identity}`;
      }
    } catch {
      // Fall through to signal-0 liveness where process-start data is absent.
    }
    try {
      process.kill(pid, 0);
      return `pid:${pid}`;
    } catch {
      return null;
    }
  };
  const identity = await processIdentity(process.pid);
  if (!identity) {
    throw new Error("migration_run_owner_identity_unavailable");
  }
  const acquire = async (): Promise<void> => {
    const candidate = `${absolute}.candidate.${randomUUID()}`;
    try {
      await mkdir(candidate, { mode: 0o700 });
      await writeFile(
        `${candidate}/owner.json`,
        JSON.stringify({ pid: process.pid, identity }),
        { mode: 0o600 },
      );
      await rename(candidate, absolute);
      await assertPrivate(absolute, "directory");
    } catch (error) {
      await rm(candidate, { recursive: true, force: true });
      if (error instanceof Error && "code" in error) {
        throw new Error("migration_run_lock_conflict");
      }
      throw error;
    }
  };
  try {
    await acquire();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "migration_run_lock_conflict"
    ) {
      throw error;
    }
    const reclaimPath = `${absolute}.reclaim`;
    let releaseReclaim: (() => Promise<void>) | null = null;
    try {
      releaseReclaim = await lock(reclaimPath, {
        realpath: false,
        stale: 30_000,
        update: 5_000,
        retries: 0,
      });
    } catch {
      throw new Error("migration_run_lock_conflict");
    }
    try {
      const lockStat = await lstat(absolute).catch(() => null);
      if (!lockStat) {
        await acquire();
      } else {
        let owner: { pid: number; identity: string } | null = null;
        try {
          const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as {
            pid?: unknown;
            identity?: unknown;
          };
          if (
            Number.isSafeInteger(parsed.pid) &&
            typeof parsed.identity === "string"
          ) {
            owner = {
              pid: parsed.pid as number,
              identity: parsed.identity,
            };
          }
        } catch {
          owner = null;
        }
        if (!owner) {
          throw new Error("migration_run_lock_conflict");
        }
        if (owner && (await processIdentity(owner.pid)) === owner.identity) {
          throw new Error("migration_run_lock_conflict");
        }
        const stalePath = `${absolute}.stale.${randomUUID()}`;
        try {
          await rename(absolute, stalePath);
        } catch {
          throw new Error("migration_run_lock_conflict");
        }
        await rm(stalePath, { recursive: true, force: true });
        await acquire();
      }
    } finally {
      await releaseReclaim();
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const releasedPath = `${absolute}.released.${randomUUID()}`;
    await rename(absolute, releasedPath);
    await rm(releasedPath, { recursive: true, force: true });
  };
}
