import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { JiraMigratorConfig } from "../cli/config.js";
import { JiraRunnerError } from "./errors.js";
import { assertNoSymlinkPathComponents } from "./privateArtifact.js";

export interface JiraRunnerArtifactPaths {
  ledgerPath: string;
  archiveRoot: string;
  accountMappingPath: string;
  reportPath: string;
}

export const requireArtifactPaths = (
  config: JiraMigratorConfig,
): JiraRunnerArtifactPaths => {
  const { ledgerPath, archiveRoot, accountMappingPath, reportPath } =
    config.artifacts;
  if (!ledgerPath || !archiveRoot || !accountMappingPath || !reportPath) {
    throw new JiraRunnerError("artifact_paths_required");
  }
  const resolved = {
    ledgerPath: resolve(ledgerPath),
    archiveRoot: resolve(archiveRoot),
    accountMappingPath: resolve(accountMappingPath),
    reportPath: resolve(reportPath),
  };
  const files = [
    resolved.ledgerPath,
    resolved.accountMappingPath,
    resolved.reportPath,
    `${resolved.reportPath}.plan.json`,
    `${resolved.reportPath}.approval.json`,
  ];
  const lockPath = `${resolved.ledgerPath}.run.lock`;
  if (new Set([...files, lockPath]).size !== files.length + 1) {
    throw new JiraRunnerError("artifact_paths_required");
  }
  const containsPath = (parent: string, candidate: string): boolean => {
    const pathFromParent = relative(parent, candidate);
    return (
      pathFromParent === "" ||
      (pathFromParent !== ".." &&
        !pathFromParent.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromParent))
    );
  };
  if (
    files.some((file) => containsPath(resolved.archiveRoot, file)) ||
    [...files, resolved.archiveRoot].some(
      (artifactPath) =>
        containsPath(lockPath, artifactPath) ||
        containsPath(artifactPath, lockPath),
    )
  ) {
    throw new JiraRunnerError("artifact_paths_required");
  }
  return resolved;
};

export const privateSpoolSegment = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const endpointFingerprint = (namespace: string, baseUrl: string): string => {
  const normalized = new URL(baseUrl).toString().replace(/\/$/u, "");
  return createHash("sha256")
    .update(namespace)
    .update(normalized)
    .digest("hex");
};

export const targetEndpointFingerprint = (baseUrl: string): string =>
  endpointFingerprint("reef:jira-migrator:akb-endpoint:v1\0", baseUrl);

export const jiraEndpointFingerprint = (baseUrl: string): string =>
  endpointFingerprint("reef:jira-migrator:jira-endpoint:v1\0", baseUrl);

export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

export const ensurePrivateDirectory = async (path: string): Promise<void> => {
  if (process.platform === "win32") {
    throw new Error("artifact_acl_verification_unsupported");
  }
  await assertNoSymlinkPathComponents(path);
  try {
    const stat = await lstat(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700
    ) {
      throw new Error("artifact_directory_permission_violation");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "artifact_directory_permission_violation"
    ) {
      throw error;
    }
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
};
