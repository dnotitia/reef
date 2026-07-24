import { canonicalizeJson } from "../rawArchive.js";

export function jiraOwnerIdentity(owner: unknown): string | null {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return null;
  const parsed = owner as Record<string, unknown>;
  return typeof parsed.jira_cloud_id === "string" &&
    typeof parsed.issue_id === "string"
    ? canonicalizeJson({
        jira_cloud_id: parsed.jira_cloud_id,
        issue_id: parsed.issue_id,
      })
    : null;
}
