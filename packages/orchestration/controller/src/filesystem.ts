import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { ControllerError } from "./errors.js";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const isMissing = (error: unknown): boolean =>
  isNodeError(error) && error.code === "ENOENT";

const assertWithin = (root: string, target: string): void => {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  const relativeTarget = relative(normalizedRoot, normalizedTarget);
  const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`;
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(parentPrefix) ||
    isAbsolute(relativeTarget)
  ) {
    throw new ControllerError("filesystem_path_escape");
  }
};

const assertMode = (
  mode: number,
  expected: number,
  kind: "file" | "directory",
): void => {
  if (process.platform !== "win32" && (mode & 0o777) !== expected) {
    throw new ControllerError("filesystem_permission");
  }
};

export const ensurePrivateDirectory = async (
  root: string,
  path: string,
): Promise<void> => {
  assertWithin(root, path);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new ControllerError("filesystem_symlink");
    if (!stat.isDirectory()) throw new ControllerError("filesystem_not_owned");
    assertMode(stat.mode, 0o700, "directory");
    return;
  } catch (error) {
    if (!isMissing(error)) {
      if (error instanceof ControllerError) throw error;
      throw new ControllerError("filesystem_io");
    }
  }

  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(path, 0o700);
  } catch {
    throw new ControllerError("filesystem_io");
  }

  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new ControllerError("filesystem_symlink");
    if (!stat.isDirectory()) throw new ControllerError("filesystem_not_owned");
    assertMode(stat.mode, 0o700, "directory");
  } catch (error) {
    if (error instanceof ControllerError) throw error;
    throw new ControllerError("filesystem_io");
  }
};

const assertPrivateDirectory = async (
  root: string,
  path: string,
): Promise<void> => {
  assertWithin(root, path);
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch {
    throw new ControllerError("filesystem_io");
  }
  if (stat.isSymbolicLink()) throw new ControllerError("filesystem_symlink");
  if (!stat.isDirectory()) throw new ControllerError("filesystem_not_owned");
  assertMode(stat.mode, 0o700, "directory");
};

export const assertPrivateFile = async (
  root: string,
  path: string,
): Promise<void> => {
  assertWithin(root, path);
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch {
    throw new ControllerError("filesystem_io");
  }
  if (stat.isSymbolicLink()) throw new ControllerError("filesystem_symlink");
  if (!stat.isFile()) throw new ControllerError("filesystem_not_owned");
  assertMode(stat.mode, 0o600, "file");
};

export const readPrivateJson = async (
  root: string,
  path: string,
): Promise<unknown | null> => {
  assertWithin(root, path);
  try {
    await lstat(dirname(path));
  } catch (error) {
    if (isMissing(error)) return null;
    throw new ControllerError("filesystem_io");
  }
  await assertPrivateDirectory(root, dirname(path));
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw new ControllerError("filesystem_io");
  }
  await assertPrivateFile(root, path);
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new ControllerError("malformed_state");
  }
};

const syncDirectory = async (path: string): Promise<void> => {
  if (process.platform === "win32") return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch {
    throw new ControllerError("filesystem_io");
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const writeAtomicJson = async (
  root: string,
  path: string,
  serialized: string,
): Promise<void> => {
  assertWithin(root, path);
  const directory = dirname(path);
  await ensurePrivateDirectory(root, directory);

  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new ControllerError("filesystem_symlink");
    if (!stat.isFile()) throw new ControllerError("filesystem_not_owned");
    assertMode(stat.mode, 0o600, "file");
  } catch (error) {
    if (!isMissing(error)) {
      if (error instanceof ControllerError) throw error;
      throw new ControllerError("filesystem_io");
    }
  }

  const temporary = resolve(
    directory,
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  assertWithin(root, temporary);
  let created = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    created = true;
    if (process.platform !== "win32") await handle.chmod(0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(directory);
    await assertPrivateFile(root, path);
  } catch (error) {
    if (error instanceof ControllerError) throw error;
    throw new ControllerError("filesystem_io");
  } finally {
    await handle?.close().catch(() => undefined);
    if (created) await rm(temporary, { force: true }).catch(() => undefined);
  }
};

export const writeExclusiveJson = async (
  root: string,
  path: string,
  serialized: string,
): Promise<boolean> => {
  assertWithin(root, path);
  const directory = dirname(path);
  await ensurePrivateDirectory(root, directory);
  const temporary = resolve(
    directory,
    `.${basename(path)}.${randomUUID()}.claim.tmp`,
  );
  assertWithin(root, temporary);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  let completed = false;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    created = true;
    if (process.platform !== "win32") await handle.chmod(0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, path);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") return false;
      throw error;
    }
    await unlink(temporary);
    await syncDirectory(directory);
    await assertPrivateFile(root, path);
    completed = true;
    return true;
  } catch (error) {
    if (error instanceof ControllerError) throw error;
    throw new ControllerError("filesystem_io");
  } finally {
    await handle?.close().catch(() => undefined);
    if (created && !completed) {
      await unlink(temporary).catch(() => undefined);
    }
  }
};

export const removePrivateFile = async (
  root: string,
  path: string,
): Promise<void> => {
  assertWithin(root, path);
  await assertPrivateFile(root, path);
  try {
    await unlink(path);
  } catch {
    throw new ControllerError("filesystem_io");
  }
  await syncDirectory(dirname(path));
};
