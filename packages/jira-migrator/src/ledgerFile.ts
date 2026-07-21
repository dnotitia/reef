import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type JiraMigrationLedgerV1,
  JiraMigrationLedgerV1Schema,
  createJiraMigrationLedger,
} from "./ledger.js";
import { canonicalizeJson } from "./rawArchive.js";

export type JiraMigrationLedgerFileErrorCode =
  | "malformed_json"
  | "unsupported_schema_version"
  | "ledger_schema_invalid"
  | "source_scope_mismatch"
  | "target_scope_mismatch"
  | "permission_violation"
  | "symlink_not_allowed"
  | "lock_conflict"
  | "write_precondition_required"
  | "stale_ledger"
  | "secret_material_detected"
  | "external_acl_required"
  | "ledger_io_failed";

export class JiraMigrationLedgerFileError extends Error {
  constructor(readonly code: JiraMigrationLedgerFileErrorCode) {
    super(code);
    this.name = "JiraMigrationLedgerFileError";
  }

  toJSON(): { name: string; code: JiraMigrationLedgerFileErrorCode } {
    return { name: this.name, code: this.code };
  }
}

const fail = (code: JiraMigrationLedgerFileErrorCode): never => {
  throw new JiraMigrationLedgerFileError(code);
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const readStat = async (path: string) => {
  try {
    return await lstat(path);
  } catch {
    return fail("ledger_io_failed");
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    return fail("ledger_io_failed");
  }
};

const assertPrivateNode = async (
  path: string,
  kind: "file" | "directory",
): Promise<void> => {
  const stat = await readStat(path);
  if (stat.isSymbolicLink()) fail("symlink_not_allowed");
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    fail("ledger_io_failed");
  }
  if (process.platform !== "win32") {
    const expected = kind === "file" ? 0o600 : 0o700;
    if ((stat.mode & 0o777) !== expected) fail("permission_violation");
  }
};

const ensurePrivateDirectory = async (path: string): Promise<void> => {
  try {
    await lstat(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT")
      fail("ledger_io_failed");
    try {
      await mkdir(path, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(path, 0o700);
    } catch {
      fail("ledger_io_failed");
    }
  }
  await assertPrivateNode(path, "directory");
};

const forbiddenKeys = new Set([
  "authorization",
  "auth_header",
  "cookie",
  "set_cookie",
  "api_key",
  "password",
  "secret",
  "secret_file",
  "secret_path",
  "raw_payload",
  "jira_payload",
]);

const normalizedKey = (value: string): string =>
  value.toLowerCase().replaceAll("-", "_");

const assertNoSecrets = (
  value: unknown,
  forbiddenValues: readonly string[],
  ancestors = new Set<object>(),
): void => {
  if (typeof value === "string") {
    if (
      forbiddenValues.some(
        (secret) => secret.length > 0 && value.includes(secret),
      )
    ) {
      fail("secret_material_detected");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) fail("ledger_schema_invalid");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value)
        assertNoSecrets(item, forbiddenValues, ancestors);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(normalizedKey(key)))
        fail("secret_material_detected");
      assertNoSecrets(item, forbiddenValues, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
};

const parseLedger = (raw: string): JiraMigrationLedgerV1 => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("malformed_json");
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "schema_version" in value &&
    (value as { schema_version?: unknown }).schema_version !== 1
  ) {
    fail("unsupported_schema_version");
  }
  const parsed = JiraMigrationLedgerV1Schema.safeParse(value);
  return parsed.success ? parsed.data : fail("ledger_schema_invalid");
};

const loadLedger = async ({
  path,
  jiraCloudId,
  targetVault,
  allowLock,
}: {
  path: string;
  jiraCloudId: string;
  targetVault: string;
  allowLock: boolean;
}): Promise<JiraMigrationLedgerV1> => {
  const absolutePath = resolve(path);
  if (!allowLock && (await pathExists(`${absolutePath}.lock`))) {
    fail("lock_conflict");
  }
  if (!(await pathExists(absolutePath))) {
    return createJiraMigrationLedger({ jiraCloudId, targetVault });
  }
  await assertPrivateNode(dirname(absolutePath), "directory");
  await assertPrivateNode(absolutePath, "file");
  const raw = await readFile(absolutePath, "utf8").catch(() =>
    fail("ledger_io_failed"),
  );
  const ledger = parseLedger(raw);
  if (ledger.source_scope.jira_cloud_id !== jiraCloudId) {
    fail("source_scope_mismatch");
  }
  if (ledger.target_scope.vault !== targetVault) fail("target_scope_mismatch");
  return ledger;
};

export const loadJiraMigrationLedger = async (input: {
  path: string;
  jiraCloudId: string;
  targetVault: string;
}): Promise<JiraMigrationLedgerV1> =>
  loadLedger({ ...input, allowLock: false });

const writeFlushedExclusive = async (
  path: string,
  bytes: string,
): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
};

export const writeJiraMigrationLedger = async ({
  path,
  ledger,
  expectedLedger,
  forbiddenSecretValues = [],
  externalAclAcknowledged = false,
}: {
  path: string;
  ledger: JiraMigrationLedgerV1;
  expectedLedger?: JiraMigrationLedgerV1;
  forbiddenSecretValues?: readonly string[];
  externalAclAcknowledged?: boolean;
}): Promise<void> => {
  if (process.platform === "win32" && !externalAclAcknowledged) {
    fail("external_acl_required");
  }
  assertNoSecrets(ledger, forbiddenSecretValues);
  const parseResult = JiraMigrationLedgerV1Schema.safeParse(ledger);
  const parsed = parseResult.success
    ? parseResult.data
    : fail("ledger_schema_invalid");
  const expectedParseResult = expectedLedger
    ? JiraMigrationLedgerV1Schema.safeParse(expectedLedger)
    : null;
  const parsedExpected = expectedParseResult?.success
    ? expectedParseResult.data
    : expectedParseResult
      ? fail("ledger_schema_invalid")
      : undefined;
  const absolutePath = resolve(path);
  const directory = dirname(absolutePath);
  await ensurePrivateDirectory(directory);

  const lockPath = `${absolutePath}.lock`;
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  let lockCreated = false;
  try {
    try {
      await writeFlushedExclusive(lockPath, "locked\n");
      lockCreated = true;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") fail("lock_conflict");
      fail("ledger_io_failed");
    }
    await assertPrivateNode(lockPath, "file");
    const artifactExists = await pathExists(absolutePath);
    const current = await loadLedger({
      path: absolutePath,
      jiraCloudId: parsed.source_scope.jira_cloud_id,
      targetVault: parsed.target_scope.vault,
      allowLock: true,
    });
    if (artifactExists && !parsedExpected) {
      fail("write_precondition_required");
    }
    if (
      parsedExpected &&
      canonicalizeJson(current) !== canonicalizeJson(parsedExpected)
    ) {
      fail("stale_ledger");
    }
    await writeFlushedExclusive(temporaryPath, canonicalizeJson(parsed));
    await assertPrivateNode(temporaryPath, "file");
    await rename(temporaryPath, absolutePath);
    if (process.platform !== "win32") {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
    const readback = await loadLedger({
      path: absolutePath,
      jiraCloudId: parsed.source_scope.jira_cloud_id,
      targetVault: parsed.target_scope.vault,
      allowLock: true,
    });
    if (canonicalizeJson(readback) !== canonicalizeJson(parsed)) {
      fail("ledger_io_failed");
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof JiraMigrationLedgerFileError) throw error;
    fail("ledger_io_failed");
  } finally {
    if (lockCreated) await rm(lockPath, { force: true }).catch(() => undefined);
  }
};
