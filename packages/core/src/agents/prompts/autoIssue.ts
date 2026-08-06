import type { AutoIssueUserPromptRequest } from "../../schemas/ai/prompts";
import { AUTO_ISSUE_LLM_RESPONSE_FIELDS } from "../activityScan/types";
import { authoringLanguageDirective } from "./authoringLanguage";
import { buildCurrentDateContext } from "./dateContext";
import { formatPlanningContextForPrompt } from "./planningContext";
import { formatTemplateCatalog } from "./templateCatalog";

function quotedFieldPresent(field: string): string {
  return `"${field}"`;
}

/**
 * Build the system prompt for auto-issue generation from untracked code activity.
 *
 * `authoringLanguage` (REEF-136) is the workspace default authoring language; when
 * set, generated title/content are written in that language. Omit or pass null to
 * preserve the prior model-default behavior.
 *
 * Ported from Tauri-era `build_auto_issue_system_prompt(prefix)` (commit e554ed3).
 */
export function buildAutoIssueSystemPrompt(
  projectPrefix: string,
  authoringLanguage?: string | null,
): string {
  const { today, timeZone } = buildCurrentDateContext();
  return `You are an AI assistant that helps product managers track developer work by
creating issue drafts from code activity that has no associated issue.

This project uses issue IDs with the prefix: ${projectPrefix} (e.g., ${projectPrefix}-001)
Today is ${today}. Timezone: ${timeZone}.

Given untracked code activity (a PR or commit with no issue reference), analyze the
content and generate a structured issue draft in business/PM-friendly language.

You have access to read-only tools for grounding. For non-trivial activity,
call search_issues before returning a draft. If any candidate is semantically
the same feature, bug, or scope of work, return null even when that existing
issue is done or closed. Use read_issue to confirm likely duplicates or
relationships. If using a template body structure for content, call
read_template first.

AVAILABLE TOOLS:
- search_issues({ "query": "...", "status": null, "assigned_to": null, "labels": null, "limit": 10 }): Hybrid-search existing Reef issues across all statuses when status is null.
- read_issue({ "id": "REEF-123" }): Read an existing issue's full metadata and content.
- read_template({ "name": "bug" }): Read a full issue template, including markdown body.

Return ONLY a valid JSON object (no markdown, no commentary) matching this exact schema:
Allowed issue field keys in this response are: ${AUTO_ISSUE_LLM_RESPONSE_FIELDS.map(quotedFieldPresent).join(", ")}.

{
  "title": "<concise action-oriented title describing the feature or fix>",
  "content": "<markdown issue content in PM/business language -- NOT raw commit messages>",
  "issue_type": "<one of: epic, story, task, bug, spike, chore>",
  "priority": "<one of: critical, high, medium, low>",
  "severity": "<one of: blocker, critical, major, minor, trivial>",
  "requester": "<requester if explicitly named>",
  "reporter": "<reporter if explicitly named>",
  "start_date": "<ISO 8601 date; use the Activity date unless an explicit start date is stated>",
  "due_date": "<ISO 8601 date only if explicitly stated>",
  "milestone_id": "<milestone id from Planning Context only if explicitly named>",
  "sprint_id": "<sprint id from Planning Context only if explicitly named>",
  "release_id": "<release id from Planning Context only if explicitly named>",
  "estimate_points": <non-negative number if scope is clear>,
  "parent_id": "<existing issue id if this clearly belongs under one>",
  "depends_on": ["<existing issue id>"],
  "blocks": ["<existing issue id>"],
  "related_to": ["<existing issue id>"],
  "labels": ["<label1>", "<label2>"],
  "reasoning": "<one sentence: why this was flagged as meaningful work>",
  "confidence": <0.0 to 1.0>
}

RULES:
1. Write "content" in plain PM language. Translate code changes into business impact.
   GOOD: "Implemented rate limiting middleware to protect API endpoints from abuse."
   BAD: "Added RateLimiter struct in middleware.rs with per-route configuration."
2. If "Issue Templates" are provided, choose the most relevant template. Before using its markdown body as the structural basis for "content", call read_template. Keep useful headings/checklists, replace placeholders with concrete content inferred from the activity, and omit sections that cannot be filled honestly.
3. If a selected template has title_prefix, priority, or default_labels that fit the activity, reflect them in the title/priority/labels fields. Do not force a template when none fits.
4. "priority" must be exactly one of: "critical", "high", "medium", "low". If unclear, use "medium".
5. "issue_type" must be exactly one of: "epic", "story", "task", "bug", "spike", "chore". If unclear, use "task".
6. "severity" is only for bugs/incidents/support-impacting work. Omit it for routine feature/chore work.
7. For "start_date", use the Activity date from the prompt unless the text explicitly names a different start date.
8. "due_date" must only be set when PR body, branch, template, or activity text explicitly names a deadline.
9. "milestone_id", "sprint_id", and "release_id" must only use IDs from Planning Context, and only when the activity text, branch, PR, or template explicitly names that planning item. Do not infer planning IDs from date ranges alone.
10. "parent_id", "depends_on", "blocks", and "related_to" must only use existing issue IDs discovered through search_issues/read_issue. Never invent IDs.
11. "labels" should be 1-3 relevant labels. Use empty array if none obvious.
12. "confidence" must be between 0.0 and 1.0 (how certain you are this represents meaningful work).
13. Do NOT output PR links, commit links, branches, or implementation_refs. The system records them from provenance.
14. Return null (not an object) for trivial/noisy activity that should NOT become an issue:
   - Dependency version bumps (e.g., "chore: bump lodash to 4.17.21")
   - Auto-formatting or style-only changes
   - CI/CD config changes with no user-facing impact
   - Merge commits with no meaningful description
   - Test-only changes that fix flaky tests
15. Return null (not an object) when the activity is SEMANTICALLY a duplicate of any
   existing issue found by search_issues/read_issue: same feature, same bug, or same
   scope of work. This applies across all statuses, including done and closed.
   Examples:
   - Activity "Fix OAuth token expiry" + existing "OAuth token auto-refresh broken" → null
   - Activity "Implement rate limit middleware" + existing "Add rate limiting to API" → null
   PMs only want NEW work surfaced; ongoing work is already tracked.
16. "reasoning" must be concise (one sentence, max 100 chars).
17. The JSON object fields must include only the draft fields shown above plus "reasoning" and "confidence"; the system records source/provenance separately.

EXAMPLE RESPONSE (for a meaningful PR):
{
  "title": "Add rate limiting to API endpoints",
  "content": "Implemented request rate limiting across all public API endpoints to prevent abuse and ensure fair usage. Configuration allows per-route limits and includes automatic retry headers for clients.",
  "issue_type": "story",
  "priority": "high",
  "labels": ["api", "security", "enhancement"],
  "reasoning": "PR adds security middleware affecting all API consumers.",
  "confidence": 0.88
}

EXAMPLE RESPONSE (for trivial/noisy activity -- return null):
null
${authoringLanguageDirective(authoringLanguage)}`;
}

function activityDateForPrompt(
  activity: AutoIssueUserPromptRequest["activity"],
): string | undefined {
  if (activity.pr) {
    return (
      activity.pr.mergedAt ??
      activity.pr.createdAt ??
      activity.pr.updatedAt ??
      undefined
    );
  }
  if (activity.commit) {
    return activity.commit.committedDate ?? activity.commit.authoredDate;
  }
  return undefined;
}

/**
 * Build the user prompt for an auto-issue generation request.
 *
 * Ported from Tauri-era `build_auto_issue_user_prompt(req)` (commit e554ed3).
 */
export function buildAutoIssueUserPrompt(
  req: AutoIssueUserPromptRequest,
): string {
  const activity = req.activity;
  let prompt = "";

  // Activity header
  prompt += "## Untracked Code Activity\n\n";
  prompt += `Event type: ${activity.eventType}\n`;
  prompt += `Actor: ${activity.actor}\n`;
  if (activity.sourceRepo) {
    prompt += `Repository: ${activity.sourceRepo}\n`;
  }
  const activityDate = activityDateForPrompt(activity);
  if (activityDate) {
    prompt += `Activity date: ${activityDate}\n`;
  }
  prompt += "\n";

  // PR details
  if (activity.pr) {
    const pr = activity.pr;
    prompt += "### Pull Request Details\n\n";
    prompt += `PR #${pr.number}: ${pr.title}\n`;
    prompt += `Branch: ${pr.headBranch}\n`;
    if (pr.createdAt) prompt += `Created: ${pr.createdAt}\n`;
    if (pr.updatedAt) prompt += `Updated: ${pr.updatedAt}\n`;
    if (pr.mergedAt) prompt += `Merged: ${pr.mergedAt}\n`;
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

  // Commit details
  if (activity.commit) {
    const commit = activity.commit;
    const shortHash = commit.hash.slice(0, Math.min(7, commit.hash.length));
    prompt += "### Commit Details\n\n";
    prompt += `Hash: ${shortHash}\n`;
    prompt += `Message: ${commit.message}\n`;
    prompt += `Branch: ${commit.branch}\n`;
    if (commit.authoredDate) prompt += `Authored: ${commit.authoredDate}\n`;
    if (commit.committedDate) {
      prompt += `Committed: ${commit.committedDate}\n`;
    }
    if (commit.changedFiles.length > 0) {
      prompt += `Changed files (${commit.changedFiles.length}):\n`;
      for (const f of commit.changedFiles.slice(0, 10)) {
        prompt += `  - ${f}\n`;
      }
      if (commit.changedFiles.length > 10) {
        prompt += `  ... and ${commit.changedFiles.length - 10} more\n`;
      }
    }
    prompt += "\n";
  }

  prompt += formatPlanningContextForPrompt(req.planningCatalog, {
    heading: "## Planning Context\n\n",
    unavailableHeading: "## Planning Context: (unavailable)\n",
    noneHeading: "## Planning Context: (none)\n",
    includeDateInferenceRule: true,
  });
  prompt += "\n";
  prompt += formatTemplateCatalog(req.templateCatalog ?? []);

  prompt +=
    "\nAnalyze this code activity. If it represents meaningful work not tracked by any issue, generate a draft issue. If trivial/noisy, return null.";
  return prompt;
}
