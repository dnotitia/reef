import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodError } from "zod";
import {
  type JiraAccountMappingArtifact,
  JiraAccountMappingArtifactSchema,
  createJiraAccountMappingArtifact,
} from "./accountMapping.js";

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
  await writeFile(path, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
}
