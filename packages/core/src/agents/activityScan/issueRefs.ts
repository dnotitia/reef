export function buildIssueIdRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}-\\d+`, "i");
}

export function extractIssueRef(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? match[0].toUpperCase() : null;
}

export function normalizeIssueRef(
  value: string,
  projectPrefix: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const issueIdRegex = buildIssueIdRegex(projectPrefix);
  const match = trimmed.match(issueIdRegex);
  if (!match || match[0].length !== trimmed.length) return null;
  return match[0].toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function collectToolResults(result: unknown): unknown[] {
  const root = asRecord(result);
  if (!root) return [];

  const toolResults: unknown[] = [];
  if (Array.isArray(root.toolResults)) {
    toolResults.push(...root.toolResults);
  }
  if (Array.isArray(root.steps)) {
    for (const step of root.steps) {
      const stepRecord = asRecord(step);
      if (stepRecord && Array.isArray(stepRecord.toolResults)) {
        toolResults.push(...stepRecord.toolResults);
      }
    }
  }
  return toolResults;
}

export function collectGroundedIssueRefs(
  result: unknown,
  projectPrefix: string,
): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const toolResult of collectToolResults(result)) {
    const resultRecord = asRecord(toolResult);
    if (!resultRecord) continue;
    const toolName = resultRecord.toolName;
    const output = asRecord(resultRecord.output);
    if (!output) continue;

    if (toolName === "search_issues" && Array.isArray(output.issues)) {
      for (const issue of output.issues) {
        const issueRecord = asRecord(issue);
        const id = issueRecord?.id;
        if (typeof id !== "string") continue;
        const normalized = normalizeIssueRef(id, projectPrefix);
        if (normalized) refs.add(normalized);
      }
    }

    if (toolName === "read_issue") {
      const issue = asRecord(output.issue);
      const id = issue?.id;
      if (typeof id !== "string") continue;
      const normalized = normalizeIssueRef(id, projectPrefix);
      if (normalized) refs.add(normalized);
    }
  }
  return refs;
}
