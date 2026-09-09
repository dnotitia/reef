export function planningWorkflowsContent(): string {
  return `# Reef Planning Workflows

Use this runbook for sprints, milestones, releases, and issue planning links.

## Planning tables

- reef_sprints stores short execution timeboxes.
- reef_milestones stores goals or checkpoints.
- reef_releases stores delivery bundles.

Reference these tables bare and unquoted in SQL (reef_sprints, not "reef_sprints"). Planning rows have no created/updated/actor columns; they contain typed columns plus an extension meta json. Ordinary planning edits preserve that meta; the sprint rollover action uses meta.sprint_rollover for its durable recovery state.

## Status values

Sprint status values: planned, active, closed.
Milestone status values: open, closed.
Release status values: planned, in_progress, released.

## Create planning items

Create rows directly with akb_sql.

- Do not set id on insert. akb auto-assigns each planning row a uuid primary key (the id column); insert only the typed columns. To recover the new id, select the row back by its unique name.
- Names should be unique within the same planning table, case-insensitively.

## Active sprint

At most one sprint is treated as current: the row with status = 'active'. If several are active, pick the one with the most recent start_date, then the highest id:
  SELECT * FROM reef_sprints WHERE status = 'active'

The active sprint only drives the default board view. reef-web never auto-assigns it, or any milestone or release, when an issue is created.

## Assign issues

Before assigning an issue, verify that the target row exists.

- Set reef_issues.sprint_id to a reef_sprints.id.
- Set reef_issues.milestone_id to a reef_milestones.id.
- Set reef_issues.release_id to a reef_releases.id.

Also update reef_issues.meta.last_editor and, when status changes, meta.last_status_change.

Planning links are explicit, not defaulted. There is no product default for sprint, milestone, or release. If you want to follow a workspace convention (for example, attaching new work to the active sprint or the standard milestone and release), propose it and confirm with the user rather than writing it silently. See conversational-playbook.md.

## Close an active sprint and roll over

Use Reef's close-and-roll-over action for a user-confirmed sprint-only carry-forward. It is a user-triggered operation, not a date-triggered job.

1. Read the source sprint and all linked issues before any write. The first run is allowed only when the source status is active, there is no other active sprint, and the caller has writer access. A planned or already-closed sprint without a persisted rollover claim is not a close candidate.
2. Require the user to choose one existing planned sprint or provide a new planned sprint. Never infer an existing target by name. Validate the source end date and the target start/end dates as UTC calendar dates, and keep the exact target id and confirmed dates in the source sprint's meta.sprint_rollover envelope before closing the source.
3. Prepare a new target as planned, then close the source with the confirmed end date, and activate that same target. If a preparation, close, or activation step fails, do not begin issue moves; retry the same persisted operation after correcting the failure. Do not close an unrelated active sprint.
4. Only unarchived issues whose sprint_id is the source id and whose status is todo, in_progress, or in_review are carry-forward candidates. Keep done, closed, backlog, and archived rows unchanged. Immediately before each move, reread the issue and use its updated_at as the expected row revision; a status, archive, or sprint change after preview is a skip or conflict, never an overwrite.
5. Move only sprint_id. Preserve lifecycle status, assignee, release/milestone links, body, and every other issue field. Set meta.last_editor to the actor and meta.source to user:sprint_rollover for UI actions or ai-agent:sprint_rollover for trusted automation. Append one idempotent reef_activity planning_link event with field=sprint and from/to source and target ids for every successful move.
6. Persist each issue outcome in meta.sprint_rollover.issue_states. A moved issue whose planning_link append failed remains incomplete and must be retried with the same event timestamp; a complete operation can be called again safely as a no-op. Partial failures and current-state conflicts stay visible in the result and never become a false full success.

## Backlog and sprint commitment

A sprint is a commitment: putting an issue in a sprint says the team has taken it on for this timebox. The backlog status means the opposite -- work that is not committed yet. So the two cannot coexist on one row: a backlog issue carries no sprint_id, and the moment you attach a sprint you move the issue out of backlog in the same write -- to todo, unless it is already further along -- and stamp meta.last_status_change. A row left with status = 'backlog' and a sprint_id set reads as "not committed" and "in this sprint" at once, which is the contradiction to avoid.

Milestones and releases are not commitments in this sense -- they group work by goal or delivery bundle -- so a backlog issue may carry a milestone_id or release_id. When you propose planning links, keep sprint commitment separate from milestone/release grouping.

## Delete planning items

Before deleting a sprint, milestone, or release, query reef_issues for references.

- For a sprint, check sprint_id.
- For a milestone, check milestone_id.
- For a release, check release_id.

Do not delete a planning item while any issue still references it. Reassign or clear the issues first.
`;
}
