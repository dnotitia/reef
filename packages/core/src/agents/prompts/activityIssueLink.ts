import type { ActivityIssueLinkUserPromptRequest } from "../../schemas/ai/prompts";

/**
 * Build the system prompt for linking ID-less GitHub activity to existing
 * Reef issues. The model just decides whether the activity belongs to an
 * existing issue; status and field changes are handled downstream.
 */
export function buildActivityIssueLinkSystemPrompt(
  projectPrefix: string,
): string {
  return `You are an AI assistant that links GitHub activity to existing Reef issues.

This project uses issue IDs with the prefix: ${projectPrefix} (e.g., ${projectPrefix}-001).
The activity you receive has NO explicit issue ID. Your job is only to decide
whether it clearly belongs to an existing issue.

You have access to read-only tools:
- search_issues({ "query": "...", "status": ["backlog", "todo", "in_progress", "in_review"], "assigned_to": null, "labels": null, "limit": 5 }): Find candidate issues. Include backlog so activity on a not-yet-started issue can still ground to it.
- read_issue({ "id": "${projectPrefix}-123" }): Read a candidate issue in full. Read at most the top 3 candidates.

Return ONLY a valid JSON object (no markdown, no commentary) with this exact schema:

{
  "decision": "linked" | "possible_link" | "no_link",
  "issue_id": "${projectPrefix}-123 or null",
  "confidence": 0.0,
  "rationale": "<one concise sentence explaining the link decision>"
}

RULES:
1. Always call search_issues before returning.
2. Use read_issue to confirm strong or plausible candidates. Read no more than 3 issues.
3. Return "linked" only when the activity is clearly the same feature, bug, or task scope as an existing issue.
4. Return "possible_link" when an issue may be related but the match is ambiguous or partial.
5. Return "no_link" when no candidate issue matches the same scope of work.
6. Do NOT choose a target status. Do NOT propose status, label, priority, planning, or reference changes.
7. Do NOT create a new issue. Do NOT invent issue IDs.
8. For "linked", issue_id must be a discovered existing issue ID and confidence should be at least 0.82.
9. For "possible_link" or "no_link", issue_id may be null and confidence should reflect uncertainty.

EXAMPLE RESPONSE:
{
  "decision": "linked",
  "issue_id": "${projectPrefix}-042",
  "confidence": 0.88,
  "rationale": "The PR describes the same login redirect fix tracked by the existing issue."
}
`;
}

export function buildActivityIssueLinkUserPrompt(
  req: ActivityIssueLinkUserPromptRequest,
): string {
  const { activity } = req;
  let prompt = "## GitHub Activity Without Explicit Issue ID\n\n";
  prompt += `Event type: ${activity.eventType}\n`;
  prompt += `Actor: ${activity.actor}\n`;
  if (activity.sourceRepo) {
    prompt += `Repository: ${activity.sourceRepo}\n`;
  }
  prompt += `Project prefix: ${req.projectPrefix}\n\n`;

  if (activity.pr) {
    const pr = activity.pr;
    prompt += "### Pull Request\n\n";
    prompt += `PR #${pr.number}: ${pr.title}\n`;
    prompt += `Branch: ${pr.headBranch}\n`;
    if (pr.createdAt) prompt += `Created: ${pr.createdAt}\n`;
    if (pr.updatedAt) prompt += `Updated: ${pr.updatedAt}\n`;
    prompt += `Merged: ${pr.mergedAt ? "yes" : "no"}\n`;
    if (pr.body && pr.body.trim().length > 0) {
      prompt += `Description:\n${pr.body}\n`;
    }
    if (pr.commitMessages.length > 0) {
      prompt += "\nCommit messages:\n";
      for (const msg of pr.commitMessages) {
        prompt += `  - ${msg}\n`;
      }
    }
    prompt += "\n";
  }

  if (activity.commit) {
    const commit = activity.commit;
    const shortHash = commit.hash.slice(0, Math.min(7, commit.hash.length));
    prompt += "### Commit\n\n";
    prompt += `Hash: ${shortHash}\n`;
    prompt += `Message: ${commit.message}\n`;
    prompt += `Branch: ${commit.branch}\n`;
    if (commit.authoredDate) prompt += `Authored: ${commit.authoredDate}\n`;
    if (commit.committedDate) {
      prompt += `Committed: ${commit.committedDate}\n`;
    }
    if (commit.changedFiles.length > 0) {
      prompt += `Changed files (${commit.changedFiles.length}):\n`;
      for (const file of commit.changedFiles.slice(0, 10)) {
        prompt += `  - ${file}\n`;
      }
    }
    prompt += "\n";
  }

  prompt +=
    "Find whether this activity clearly belongs to an existing Reef issue. Return linked only for a strong same-scope match.";
  return prompt;
}
