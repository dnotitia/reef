import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ZodError } from "zod";
import {
  type JiraAccountMappingArtifact,
  JiraAccountMappingArtifactSchema,
  createJiraAccountMappingArtifact,
} from "./mapping.js";

export interface LoadJiraAccountMappingArtifactOptions {
  path: string | null;
  jiraCloudId: string;
}

export class JiraAccountMappingFileError extends Error {
  constructor(readonly issues: string[]) {
    super("jira_account_mapping_file_invalid");
    this.name = "JiraAccountMappingFileError";
  }
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const formatZodIssues = (error: ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });

export async function loadJiraAccountMappingArtifact({
  path,
  jiraCloudId,
}: LoadJiraAccountMappingArtifactOptions): Promise<JiraAccountMappingArtifact> {
  if (!path) {
    return createJiraAccountMappingArtifact({ jiraCloudId });
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return createJiraAccountMappingArtifact({ jiraCloudId });
    }
    throw new JiraAccountMappingFileError([
      `Could not read Jira account mapping file: ${path}`,
    ]);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new JiraAccountMappingFileError([
      `Jira account mapping file is not valid JSON: ${path}`,
    ]);
  }

  const parsed = JiraAccountMappingArtifactSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new JiraAccountMappingFileError(formatZodIssues(parsed.error));
  }
  if (parsed.data.jiraCloudId !== jiraCloudId) {
    throw new JiraAccountMappingFileError([
      `Jira account mapping file cloud id ${parsed.data.jiraCloudId} does not match ${jiraCloudId}`,
    ]);
  }

  return parsed.data;
}

export async function writeJiraAccountMappingArtifact(
  path: string,
  artifact: JiraAccountMappingArtifact,
): Promise<void> {
  const parsed = JiraAccountMappingArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    throw new JiraAccountMappingFileError(formatZodIssues(parsed.error));
  }

  await mkdir(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await handle.chmod(0o600);
      await handle.writeFile(
        `${JSON.stringify(parsed.data, null, 2)}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Renaming a private same-directory file replaces the path entry itself,
    // which avoids opening, truncating, or following an existing symlink.
    await rename(temporary, path);
    if (process.platform !== "win32") {
      const directoryHandle = await open(dirname(path), constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
