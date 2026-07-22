import { chmod, lstat, mkdir } from "node:fs/promises";
import {
  RawArchiveError,
  type RawArchiveErrorCode,
  type RawArchivePermissionVerification,
} from "./model.js";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

function fail(code: RawArchiveErrorCode): never {
  throw new RawArchiveError(code);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: RawArchiveErrorCode,
): void => {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) fail(code);
};

const assertIso = (value: string): void => {
  if (!Number.isFinite(Date.parse(value)))
    fail("invalid_archive_configuration");
};

const modeBits = (mode: number): number => mode & 0o777;

export const assertSecureNode = async (
  path: string,
  kind: "directory" | "file",
  permissionModel: "posix" | "windows",
): Promise<void> => {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      fail(kind === "file" ? "object_missing" : "archive_io_failed");
    }
    fail("archive_io_failed");
  }
  if (stat.isSymbolicLink()) fail("symlink_not_allowed");
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) {
    fail("archive_io_failed");
  }
  if (permissionModel === "posix") {
    const expected = kind === "directory" ? 0o700 : 0o600;
    if (modeBits(stat.mode) !== expected) fail("permission_violation");
  }
};

export const ensureSecureDirectory = async (
  path: string,
  permissionModel: "posix" | "windows",
): Promise<void> => {
  let created = false;
  try {
    await lstat(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT")
      fail("archive_io_failed");
    try {
      await mkdir(path, { recursive: true, mode: 0o700 });
      created = true;
    } catch {
      fail("archive_io_failed");
    }
  }
  if (created && permissionModel === "posix") {
    try {
      await chmod(path, 0o700);
    } catch {
      fail("archive_io_failed");
    }
  }
  await assertSecureNode(path, "directory", permissionModel);
};

export const validateRawArchivePermissionVerification = (
  permissionVerification: RawArchivePermissionVerification,
  platform: NodeJS.Platform = process.platform,
): "posix" | "windows" => {
  if (!isRecord(permissionVerification)) fail("invalid_archive_configuration");
  if (platform === "win32") {
    assertExactKeys(
      permissionVerification,
      ["kind", "verified_by", "verified_at"],
      "invalid_archive_configuration",
    );
    if (
      permissionVerification.kind !== "external_acl" ||
      !permissionVerification.verified_by
    ) {
      fail("invalid_archive_configuration");
    }
    assertIso(permissionVerification.verified_at);
    return "windows";
  }
  assertExactKeys(
    permissionVerification,
    ["kind", "verified"],
    "invalid_archive_configuration",
  );
  if (
    permissionVerification.kind !== "posix_mode" ||
    !permissionVerification.verified
  ) {
    fail("invalid_archive_configuration");
  }
  return "posix";
};
