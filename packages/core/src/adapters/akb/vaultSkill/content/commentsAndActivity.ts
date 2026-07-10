export function commentsAndActivityContent(): string {
  return `# Reef Comments and Activity History

Use this runbook for requests such as "Show the history of REEF-012", "What changed on this issue", "Show the comments on REEF-012", or "Add a comment saying ...". It covers two read-oriented surfaces an agent reaches through akb_sql: the issue's activity timeline (reef_activity) and its discussion thread (reef_comments). The column manifests for both tables are in pm-model.md.

Activity events are WRITTEN only as a side effect of a lifecycle change -- see "Record a field-change activity event" and the status_change rule in issue-workflows.md. This runbook is how you READ that history back, and how you read and write comments.

## Read an issue's activity timeline

reef_activity is the issue's immutable audit history (the Jira changelog / Linear IssueHistory equivalent). Read it oldest-first, ordering by the semantic meta.at (ISO-8601 sorts lexically) with the akb uuid id as a stable tiebreak -- the same order the product timeline uses:

  SELECT * FROM reef_activity WHERE reef_id = 'REEF-001' ORDER BY meta->>'at' ASC, id ASC

Each row carries event_type (which kind of change), event_key (the idempotency key), payload (event-specific json), and meta with actor, at, and source. meta.at is the event time (and sort key), meta.actor is the reef-semantic actor who caused it, and meta.source is the trigger provenance or null. The actor and time come from meta, NOT from akb's auto created_by/created_at columns (those are the akb principal and akb bookkeeping).

Interpret payload by event_type:

- status_change: payload {from,to} -- the issue moved between two statuses (backlog, todo, in_progress, in_review, done, closed).
- assignee_change: payload {from,to} -- the assignee moved; either side may be null (null->alice is a claim, alice->bob a hand-off, alice->null an un-assign).
- priority_change: payload {from,to} -- priority moved between levels; either side may be null (an unset priority).
- planning_link: payload {field,from,to} -- a milestone, sprint, or release was attached or detached; field names which dimension, and from/to are the planning ids (null on attach or detach).
- impl_ref_linked: payload {ref_type,ref,repo} -- a delivery ref was linked to the issue; ref_type is pull_request, commit, or branch, ref is the PR number / SHA / branch name, and repo is owner/name or null. This is a set addition, so there is one event per newly-linked ref.

Two read rules:

- Treat the log as append-only. Never UPDATE or DELETE a reef_activity row -- events are written only by the lifecycle rules in issue-workflows.md.
- Two rows that share an event_key are the same logical change recorded twice (a best-effort append that retried); collapse them to one when you present the history.

Resilience (mirror the product read path): a vault that predates the table reads as an EMPTY history -- a read never provisions the table, and a missing-relation error means "no history yet", not a failure. Skip a single malformed row rather than blanking the whole timeline.

## Read an issue's comments

reef_comments holds the issue's discussion thread. Read it oldest-first, ordering by the semantic meta.created_at with the akb uuid id as a stable tiebreak:

  SELECT * FROM reef_comments WHERE reef_id = 'REEF-001' ORDER BY meta->>'created_at' ASC, id ASC

Each row carries body (the comment's markdown text) and meta with author, created_at, edited_at, parent_comment_id, and thread_root_id. As with activity, the author and timestamps are projected from meta -- NOT from akb's auto created_by/created_at columns. A null edited_at means the comment was never edited; a non-null edited_at marks an edited comment.

Thread rules are strict:

- A top-level comment has parent_comment_id = null and thread_root_id = null. Legacy rows where both keys are absent mean the same thing.
- A reply stores the clicked direct parent's uuid in parent_comment_id and the verified top-level comment uuid in thread_root_id.
- A reply to a reply keeps the clicked reply as parent_comment_id but inherits that reply's top-level thread_root_id. Presentation stays one visual depth.
- Position the whole thread in the global activity timeline by the root's created_at. Sort replies inside it by meta.created_at, then id.
- Skip a row when only one thread field is set, its parent/root is absent or belongs to another issue, its root is itself a reply, or its parent chain does not lead to that root. Never flatten a malformed reply into a new top-level comment.

Resilience matches the activity read: a vault with no reef_comments table reads as an EMPTY thread (a read never provisions), and a single malformed row is skipped rather than failing the whole thread.

## Write a comment

1. Resolve the acting user with akb_whoami. The comment author is the acting user. The Reef product injects the session actor as the author; on this MCP path you supply it yourself from akb_whoami. Never take the author from a client field or guess it from another row.
2. Insert a top-level comment with the issue-existence guard in the SAME conditional statement. body is markdown; both thread fields are null:

   WITH target_issue AS (
     SELECT reef_id FROM reef_issues WHERE reef_id = 'REEF-001'
   )
   INSERT INTO reef_comments (reef_id, body, meta)
   SELECT reef_id,
     'Looks good -- shipping once review passes.',
     '{"author":"ACTOR","created_at":"2026-06-19T07:34:38.237Z","edited_at":null,"parent_comment_id":null,"thread_root_id":null}'::json
   FROM target_issue
   RETURNING *;

   If RETURNING yields no row, the issue does not exist; do not insert an orphan.

## Reply to a comment

Use the clicked target comment's AKB uuid as parent_comment_id. Do not accept author or thread_root_id from an untrusted client. Resolve the actor as above and calculate the root from persisted rows. Parent/root validation and the INSERT MUST be one conditional statement with RETURNING so a parent cannot change between validation and write.

The conditional statement must enforce all of these before it inserts: the issue exists; the direct parent belongs to the same reef_id; a top-level parent becomes the root; a reply parent contributes its stored thread_root_id; the root belongs to the same issue and has both thread fields null; and a reply parent's own parent belongs to the same verified root. Store the direct parent plus the computed root in meta. If RETURNING yields no row, report the same parent-not-found error for missing, cross-issue, and malformed chains so another issue's discussion is not disclosed.

The Reef product's core create path implements this as target_issue, direct_parent, reply_target, valid_reply, and INSERT ... SELECT ... RETURNING CTEs. Trusted importers use that same path after mapping a source parent id to a target Reef comment uuid. Jira Cloud's public client comment contract does not make parentId a trusted Reef request field; never let a browser supply thread_root_id.

- The body is user-controlled free text, so escape it as data before it goes into the single-quoted literal -- this is the most important rule here. Double every single quote in the body (' becomes ''), exactly as the general rule in pm-model.md ("escape a single quote by doubling it"): a comment like it's blocked becomes the literal 'it''s blocked'. Never let comment text close the quote or be read as SQL -- the whole body is one value, never part of the statement. (The Reef product builds this value as data for you; on the akb_sql path you do the escaping yourself.)
- Write created_at in full ISO-8601 UTC. In SQL use to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'); the same truncated "+00" hazard that hides an issue row (see issue-workflows.md) rejects a malformed comment timestamp, so never write now()::text.
- Do NOT set id, created_by, created_at, or updated_at columns; AKB fills them. reef's canonical author, write time, and thread relationship live in meta, not those akb columns.
- When you compose the comment prose yourself, honor the workspace authoring language as you would for any generated prose (see "Before any write, always" in the root skill); when you are relaying the user's own words, keep them verbatim.
- akb_sql cannot run DDL, so it cannot create the table. reef_comments is provisioned for any workspace the Reef product has initialized. If the INSERT errors with a missing-relation message, the workspace predates the comments feature -- surface that rather than improvising; do not attempt to create the table.

## Edit a comment

Editing is optional and author-scoped. Only a comment's own author may edit it, and ownership is enforced in the WHERE clause so a non-author edit -- or a missing comment -- matches zero rows instead of mutating someone else's comment:

  UPDATE reef_comments
  SET body = 'Edited body text.',
      meta = jsonb_set(meta::jsonb, '{edited_at}', to_jsonb('2026-06-19T08:00:00.000Z'::text))::json
  WHERE id = '<comment-uuid>' AND reef_id = 'REEF-001' AND meta->>'author' = 'ACTOR';

- id is the comment's akb uuid from the read above. Bind reef_id as well as id so an edit routed through the wrong issue matches nothing.
- The replacement body is user-controlled too, so escape it exactly as a fresh comment -- double every single quote (' becomes '') before it goes into the literal -- so the new text can never close the quote or be read as SQL.
- jsonb_set changes only edited_at, preserving meta.author and meta.created_at; set edited_at to the current ISO timestamp.
- If the UPDATE reports 0 rows, the acting user is not the author (or the comment does not exist) -- do not retry without ownership; tell the user they cannot edit another author's comment.
- There is no delete-comment flow in the current product; do not DELETE comment rows.
`;
}
