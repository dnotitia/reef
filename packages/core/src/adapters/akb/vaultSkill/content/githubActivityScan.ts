export function githubActivityScanContent(): string {
  return `# Reef GitHub Activity Scan

Use this runbook for requests such as "Scan recent GitHub activity and create pending drafts".

## Inputs

Read monitored repositories from monitored_repos. Read the issue prefix from reef_settings where key = 'project_prefix'.

Use gh or the GitHub API to inspect recent commits and pull requests. Do not store GitHub tokens or credentials in AKB.

## Classification

Build an issue id regex from the project prefix, for example REEF-[0-9]+.

For each recent commit or pull request:

- Search commit messages, PR title, PR body, branch name, and PR commit messages for an issue id.
- If an issue id is present, create a status_change suggestion.
- If no issue id is present, create a draft suggestion.

Do not create issues directly during a scan. Scans create pending suggestions only.

## Draft suggestion

Use kind = draft. Store the proposed issue as proposal.operation = create with proposal.create.fields and proposal.create.content. Include title, issue_type, priority, labels, planning fields, relationship fields (parent_id, depends_on, blocks, related_to), implementation_refs, provenance, confidence, and reasoning when available.

The fingerprint is:

repo:type:ref

The suggestion id is:

reef-draft-{sha256(fingerprint).slice(0,16)}

## Status change suggestion

Use kind = status_change. Group all scan-window activity for the same issue into one suggestion. Derive the target status deterministically from the strongest code signal in the group -- merged PR maps to done, open PR maps to in_review, commits only map to in_progress -- and only emit the suggestion when that target is a forward move from the issue's current status: the target must be later than the current status in the order backlog < todo < in_progress < in_review < done < closed (a jump such as in_progress straight to done is allowed). Skip the suggestion when the target is at or behind the current status. The LLM writes only the rationale (PM-friendly prose) and may veto trivial activity.

Keep the underlying evidence on the suggestion as a structured list, not only folded into the fingerprint string. Each evidence item is { type: pr | commit, repo, ref, actor }, alongside the scan's detected_at. The approve step needs these fields to record delivery refs on the target issue (see "Approve a status change" in activity-inbox-workflows.md) -- a fingerprint you have to take apart again is not a reliable source for that. This mirrors the draft path, which already carries implementation_refs in proposal.create.fields.

The fingerprint is:

issue_id|proposal.update.patch.status|sorted(repo:type:ref values joined by comma)

The suggestion id is:

reef-status-{sha256(fingerprint).slice(0,16)}

## Persist suggestions

For every pending suggestion, write both:

- _reef/activity-inbox/{suggestion_id}.md
- reef_activity_suggestions row

If the same fingerprint already exists and is pending, approved, or dismissed, do not create a duplicate.
`;
}
