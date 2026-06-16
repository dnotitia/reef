export function activityInboxWorkflowsContent(): string {
  return `# Reef Activity Inbox Workflows

Use this runbook for requests such as "Show pending AI drafts", "Approve this draft", or "Dismiss that suggestion".

## Storage

Each activity suggestion has two parts:

1. An AKB document under _reef/activity-inbox/{suggestion_id}.md.
2. A reef_activity_suggestions table row with the same suggestion_id.

The table row is the queryable source for inbox lists. The document stores readable summary content.

## Suggestion kinds

- draft: untracked GitHub activity that may become a new issue.
- status_change: GitHub activity that references an existing Reef issue and proposes a status transition for it.

## Status values

- pending: awaiting PM review.
- approved: accepted and applied.
- dismissed: rejected and should be suppressed in future scans.

## Show pending AI drafts

Query reef_activity_suggestions where status = 'pending'. Show draft suggestions first, then status_change suggestions.

For drafts, summarize proposal.create.fields.title, proposal.create.content summary, confidence, reasoning, repo, source_type, source_ref, and actor. For status changes, summarize proposal.update.issue_id, issue title, from_status, proposal.update.patch.status, rationale, confidence, and evidence.

## Approve a draft

1. If the suggestion is dismissed, do not approve it.
2. If an issue already exists with source ai-agent:create_issue:{suggestion_id}, do not create a duplicate.
3. Otherwise create a complete Reef issue from proposal.create.fields plus proposal.create.content.
4. Set meta.author and meta.last_editor to the approving user when known; use ai-agent only for automated approval.
5. Set the suggestion status to approved.
6. Store approved_issue_id in the suggestion meta JSON.

## Approve a status change

1. Read the target issue.
2. Apply proposal.update as an ordinary issue update. For status-change suggestions the patch is usually just { status }. Set last_status_change to the current time and source to ai-agent:status_change:{suggestion_id}. Stamp meta.last_editor with the approving user when known.
3. Record the delivery evidence on the issue, in the same update. The suggestion already carries the PR/commit evidence that justified the transition (the structured evidence list described under "Status change suggestion" in github-activity-scan.md), so this is the one moment where a tracked issue can earn its delivery refs for free. Skipping it throws that evidence away and leaves the PM to backfill the PR/commit by hand later -- exactly what happened to REEF-010 after PR #117 merged. For each evidence item, build an implementation_ref: map type pr -> pull_request and commit -> commit; carry repo, ref, actor, and detected_at; and synthesize url as https:\u002f\u002fgithub.com/{repo}/pull/{ref} for a PR or https:\u002f\u002fgithub.com/{repo}/commit/{ref} for a commit. Merge these into the issue's existing meta.implementation_refs, de-duplicating on type:repo:ref so re-approving or re-scanning the same activity never doubles an entry, and leave any unrelated refs already there untouched. (The draft -> create path fills implementation_refs for brand-new issues; this is the matching path for issues that already exist.)
4. Do NOT write the rationale into the issue. The rationale is shown in the inbox for review only and is discarded on approve.
5. Set the suggestion status to approved.

## Dismiss a suggestion

Set status to dismissed and record reviewed_at plus reviewed_by. Dismissed provenance or evidence refs should suppress future duplicate suggestions for the same activity.
`;
}
