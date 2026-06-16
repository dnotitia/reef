import type { StatusRationaleUserPromptRequest } from "../../schemas/ai/prompts";
import { authoringLanguageDirective } from "./authoringLanguage";

/**
 * Build the system prompt for status-change rationale generation.
 *
 * The target status transition (`from -> to`) is decided deterministically
 * upstream by `scanActivity` (via `inferStatusFromCodeSignal` + `canTransition`).
 * The LLM's just job is to write a short, PM-friendly justification for that
 * transition — or to veto it by returning `null` when the code activity is too
 * trivial to justify moving the issue.
 *
 * `authoringLanguage` (REEF-136) is the workspace default authoring language; when
 * set, the rationale prose is written in that language. Omit or pass null to
 * preserve the prior model-default behavior.
 */
export function buildStatusRationaleSystemPrompt(
  authoringLanguage?: string | null,
): string {
  return `You are an AI assistant that helps product managers keep issue status in
sync with development progress.

You are given a linked issue (id, title, current status), a PROPOSED status
transition (from -> to) that has already been determined from the code
activity, and the matched activity itself (PR details, commit messages).

Your job is to write a single PM-friendly RATIONALE explaining why the issue's
status should move to the proposed target — OR to veto the transition.

Return ONLY a valid JSON object (no markdown, no commentary) with this exact schema:

{
  "rationale": "<one to two sentence justification in PM/business language>"
}

OR return null (not an object) if the activity is too trivial/noisy to justify
changing the issue's status.

RULES:
1. Write "rationale" in plain PM/business language -- NOT developer jargon.
   GOOD: "The pull request implementing the login flow was merged, so this work is complete."
   BAD: "Merged PR #42 adding JWT middleware in auth.rs."
2. Justify the SPECIFIC transition (e.g. why "done", why "in review"). Reference
   the merged/open pull request or the commits as the trigger.
3. "rationale" should be 1-2 sentences max. Focus on what the activity means for
   the issue's progress.
4. Return null for trivial/noisy activity that should NOT move the issue:
   - Dependency version bumps (e.g., "chore: bump lodash")
   - Auto-formatting or style-only changes
   - CI/CD config tweaks with no user-facing impact
   - Minor test fixes
   - Merge commits with no meaningful description
5. NEVER include: file names, function names, code snippets, technical implementation details.
6. NEVER include API keys, tokens, or any sensitive data (there should be none in the input).

EXAMPLE RESPONSE (for a merged PR completing the work):
{
  "rationale": "The pull request delivering the payment processing refactor was merged, completing this issue's work."
}

EXAMPLE RESPONSE (for trivial activity -- return null):
null
${authoringLanguageDirective(authoringLanguage)}`;
}

/**
 * Build the user prompt for a status-change rationale request.
 */
export function buildStatusRationaleUserPrompt(
  req: StatusRationaleUserPromptRequest,
): string {
  let prompt = "";

  // Issue context + proposed transition
  prompt += "## Linked Issue\n\n";
  prompt += `Issue ID: ${req.issueId}\n`;
  prompt += `Issue Title: ${req.issueTitle}\n`;
  prompt += `Current Status: ${req.fromStatus}\n`;
  prompt += `Proposed Status: ${req.toStatus}\n`;
  prompt += "\n";

  // Actor
  prompt += `Developer: ${req.actor}\n`;
  if (req.sourceRepo) {
    prompt += `Repository: ${req.sourceRepo}\n`;
  }
  prompt += "\n";

  // PR details
  if (req.pr) {
    const pr = req.pr;
    prompt += "## Pull Request\n\n";
    prompt += `PR #${pr.number}: ${pr.title}\n`;
    prompt += `Branch: ${pr.headBranch}\n`;
    prompt += `Merged: ${pr.mergedAt ? "yes" : "no"}\n`;
    if (pr.body && pr.body.trim().length > 0) {
      prompt += `Description:\n${pr.body}\n`;
    }
    if (pr.commitMessages.length > 0) {
      prompt += `\nCommit messages (${pr.commitMessages.length} total):\n`;
      for (const msg of pr.commitMessages) {
        prompt += `  - ${msg}\n`;
      }
    }
    prompt += "\n";
  }

  // Individual commit details (when no PR is available)
  const commits = req.commits ?? [];
  if (commits.length > 0) {
    prompt += `## Commits (${commits.length} total)\n\n`;
    for (const commit of commits) {
      const shortHash = commit.hash.slice(0, Math.min(7, commit.hash.length));
      prompt += `- [${shortHash}] ${commit.message}\n`;
      if (commit.changedFiles.length > 0) {
        prompt += `  Changed files: ${commit.changedFiles.length} file(s)\n`;
      }
    }
    prompt += "\n";
  }

  prompt += `Analyze this code activity linked to the issue above and justify moving its status from "${req.fromStatus}" to "${req.toStatus}". If the activity is trivial/noisy and does not justify the change, return null.`;
  return prompt;
}
