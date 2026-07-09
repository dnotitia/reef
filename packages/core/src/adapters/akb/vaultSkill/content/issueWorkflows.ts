export function issueWorkflowsContent(): string {
  return `# Reef Issue Workflows

Use this runbook for requests such as "Create an issue for...", "Update REEF-001", or "Mark REEF-001 as done". For deciding fields, asking the user, and mapping loose phrasing to actions, read conversational-playbook.md alongside this one.

## Create an issue

1. Resolve the acting user with akb_whoami. This becomes meta.author and meta.last_editor.
2. Read and decode the project prefix. The value is JSON-encoded:
   SELECT value FROM reef_settings WHERE key = 'project_prefix' LIMIT 1
   The row holds the JSON string "REEF" (with quotes); parse it to REEF. If the row is missing, default to REEF.
3. Allocate the next id. Scan existing ids and take the largest number plus one, zero-padded to at least three digits ({PREFIX}-NNN, for example REEF-001, REEF-042, REEF-1000):
   SELECT reef_id FROM reef_issues
   Parse each value as PREFIX-NUMBER, take the maximum number, add one. With no rows the first id is {PREFIX}-001. There is no locking; allocation is last-write-wins.
4. Seed the issue body from a matching template. Template names vary per vault, so do not assume the issue_type is a template name -- list what exists and pick the closest fit:
   SELECT name, label, description, title_prefix, priority, default_labels, body FROM reef_templates
   Choose the row whose name, label, or description best matches this issue_type (for example a story often maps to a feature or user-story template, a chore to tech-debt), and replace every placeholder or scaffold in its body -- whatever the convention ({{...}}, <...>, or a fill-me line) -- with real content, leaving none behind. Apply the chosen template's default priority and default_labels per the field precedence in "Default issue fields" (an explicit value or an inferred signal still overrides them). If no template fits, write a clean structured body of your own. title_prefix (for example "Task: ") is a UI seed only -- never store it in the title.
5. Create the AKB document with akb_put:
   - vault: current vault
   - collection: issues
   - title: the issue id in uppercase, for example REEF-001 (pinned for path derivation; the slug becomes reef-001)
   - type: task -- ALWAYS task. This is the AKB document type, not the reef issue_type. Every reef issue, even a bug or epic, is an AKB document of type task; the reef kind lives only in the reef_issues.issue_type column. (The AKB document-type enum has no bug/epic/etc., so passing one is rejected.)
   - summary: the human-readable issue title
   - tags: labels, as plain strings
   - depends_on: depends_on issue ids, as plain reef ids (REEF-002), not akb:// URIs
   - related_to: the deduped union of blocks and related_to ids, as plain reef ids
   - content: the issue body in markdown, seeded from the template in step 4
   Keep the akb:// URI from the response; that is the document_uri.
6. Insert the reef_issues row with the same reef_id and the document_uri from akb_put.

The AKB document title must be the uppercase issue id, not the human title. Store the human title in the document summary and the reef_issues.title column.

The row is the source of truth for status, every queryable field, and all four relationship arrays (labels, depends_on, related_to, blocks, each kept separate on the row). If the row INSERT fails after the document was created, delete the just-created document so you do not leave an orphan the board cannot see.

## reef_issues INSERT skeleton

Reference the table unquoted. Empty list columns are '[]'::json, never NULL. author and last_editor must be non-empty strings or the read path rejects the row. requester is the acting user (ACTOR in the example) on a conversational create, or NULL for an automated scan create. parent_id is the parent issue's plain reef id (REEF-012) when this issue hangs under an epic, or NULL for a top-level issue -- see "Default issue fields" for when to fill it. Example:

INSERT INTO reef_issues
  (document_uri, reef_id, title, status, issue_type, priority, assigned_to,
   requester, parent_id, labels, depends_on, related_to, blocks, meta)
VALUES
  ('akb://VAULT/coll/issues/doc/reef-001.md', 'REEF-001', 'Human title', 'backlog', 'task', NULL, NULL,
   'ACTOR', NULL, '[]'::json, '[]'::json, '[]'::json, '[]'::json,
   '{"author":"ACTOR","last_editor":"ACTOR","source":"ai-agent:user_request","last_status_change":null,"external_refs":null,"implementation_refs":null,"watchers":null,"reviewers":null,"qa_owner":null,"custom_fields":null}'::json);

For an issue that hangs under an epic, set parent_id to that epic's reef id (a plain reef id, never an akb:// URI). When you are adding to a group of siblings and do not already know the epic, read a sibling's parent_id rather than leaving it NULL:
  SELECT parent_id FROM reef_issues WHERE reef_id = 'REEF-042'
then insert with that value:

INSERT INTO reef_issues
  (document_uri, reef_id, title, status, issue_type, priority, assigned_to,
   requester, parent_id, labels, depends_on, related_to, blocks, meta)
VALUES
  ('akb://VAULT/coll/issues/doc/reef-043.md', 'REEF-043', 'Child story', 'backlog', 'story', NULL, NULL,
   'ACTOR', 'REEF-012', '[]'::json, '[]'::json, '[]'::json, '[]'::json,
   '{"author":"ACTOR","last_editor":"ACTOR","source":"ai-agent:user_request","last_status_change":null,"external_refs":null,"implementation_refs":null,"watchers":null,"reviewers":null,"qa_owner":null,"custom_fields":null}'::json);

Use the document_uri returned by akb_put verbatim; do not hand-build it. Do NOT include id, created_at, updated_at, or created_by; AKB fills them.

## Default issue fields

- status: backlog (the default landing for a new issue; pull it forward into todo when committing to work on it)
- sprint_id: unset on a new backlog issue -- a sprint is a commitment that contradicts the backlog status, so attach one only with a status of todo or later (see "Backlog and sprint commitment" in planning-workflows.md). milestone_id and release_id group work rather than commit it, so they may be set on any status
- parent_id: the epic (or parent issue) this issue hangs under -- a plain reef id (REEF-012), or NULL for a top-level issue. When the workspace groups issues under an epic, do not leave a child all-null: confirm the epic's reef id with the user, or read a sibling's parent_id (SELECT parent_id FROM reef_issues WHERE reef_id = 'REEF-042') and reuse it. This is planning invariant 4 -- propose the parent, never silently auto-write it and never silently drop it
- issue_type: task unless the user asks for epic, story, bug, spike, or chore
- priority: follow the field precedence below -- an explicit user value, else a value inferred from urgency signals, else the issue_type template's default, else unset; it may be cleared to NULL
- severity: unset; for a bug you may set blocker, critical, major, minor, or trivial (impact, distinct from priority's urgency)
- assigned_to: the owner of the work -- propose at create time, reconfirm when the issue is pulled into active work, and let it stay unset (NULL) until then. See the Assignee rule in conversational-playbook.md.
- requester: the person who asked for the work. On a conversational create default it to the acting user (ACTOR above); leave it NULL for an automated scan create. See the Requester rule in conversational-playbook.md.
- meta.author: the current acting user for user-driven creates, or ai-agent for automated agent-originated creates (the Issue schema's created_by field projects from this)
- meta.last_editor: the current acting user for user-driven creates, or ai-agent for automated agent-originated creates (the Issue schema's updated_by field projects from this)
- meta.source: ai-agent:user_request unless a more specific source applies

Field precedence when a template default and inference disagree: an explicit user value wins; else a value inferred from the description's signals (conversational-playbook.md); else the issue_type template's default; else unset. The template is authoritative for the body skeleton but only a weak fallback for field values -- a signal always overrides a template default (a low-urgency bug stays low even though the bug template defaults to high).

For how to infer issue_type, priority, labels, and a clean title from a loose description, and when to ask the user instead of guessing, read conversational-playbook.md.

## The meta skeleton

reef_issues.meta is rebuilt as a full object on every write, with every key present (null when absent). Use exactly these ten keys:

{
  "author": "the acting user (required, non-empty)",
  "last_editor": "the acting user (required, non-empty)",
  "source": "trigger provenance, for example ai-agent:user_request, or null",
  "last_status_change": "ISO timestamp of the last status change, or null",
  "external_refs": "array or null",
  "implementation_refs": "array or null",
  "watchers": "array or null",
  "reviewers": "array or null",
  "qa_owner": "string or null",
  "custom_fields": "object or null"
}

The Issue schema surfaces meta.author as created_by and meta.last_editor as updated_by, but the stored keys are always author and last_editor. When you update meta, preserve the keys you are not changing (rebuild the full object, or use jsonb_set on the specific key).

Reserved future-proof fields: watchers, reviewers, qa_owner, and custom_fields exist for future collaboration, QA, and customization workflows. They are not used by the current Reef product UI or write flows, and live in meta. Do not set or change them unless a future runbook explicitly introduces that workflow.

rank is reef's issue-wide numeric ordering scalar — a typed column, not a meta field. Lower values sort earlier, NULL sorts at the ordered tail, the product UI writes it only through the backlog view's drag-to-reorder flow, and trusted importers may seed it from source-system current order (for example Jira Rank). Do not hand-author or change rank on a conversational create or a normal field update. A normal new issue gets product/backlog defaults rather than a caller-provided rank.

## When the row is present but the board hides it

The read path validates every row's meta against the issue schema and silently skips any row that fails -- the row stays in reef_issues, but it never reaches the board, the list, or any other view, and no error is surfaced (the skip is recorded only on an internal trace). One malformed meta field is enough to drop the whole issue: a date field that is not parseable ISO-8601 (the "+00" timestamp tail above is the classic cause), a field that should be an array or object stored as a bare string, a required key (author or last_editor) left empty, or an extra/renamed key the schema does not allow.

To diagnose a row that was written but never appears, compare it field by field against a healthy, visible row:
  SELECT * FROM reef_issues WHERE reef_id IN ('REEF-MISSING', 'REEF-VISIBLE')
Line up the two meta objects and find the key whose value differs in type or shape from the working row. Then rebuild meta with the full ten-key skeleton above (correct types, valid ISO timestamps) and UPDATE the row -- it reappears as soon as the meta validates.

## Delivery links

external_refs is for PM-facing external references. Each item has:

- type: github_issue, linear, slack, jira, confluence, url, or other. For akb
  documents, use the first-class references relation flow, not external_refs.
- ref or url: the actual external reference; at least one is required
- label: optional display title shown in the UI as "Title"

implementation_refs is for delivery activity. Each item has:

- type: pull_request, commit, or branch
- ref: PR number, commit SHA, or branch name
- repo: owner/name of the repository the ref lives in, when known; activity-scan refs always carry it, and it is the key that de-dupes refs by type:repo:ref
- url: optional link
- title: optional display title
- actor and detected_at: optional provenance fields for activity-scan generated refs

## Update an issue

For table-only fields such as status, priority, assigned_to, sprint_id, milestone_id, release_id, closed_at, closed_reason, and archived_at, update reef_issues only. priority and assigned_to may be cleared to NULL.

For body, title, labels, depends_on, related_to, or blocks changes, update both the AKB document and the reef_issues row. (Note blocks has no document field; it is folded into the document's related_to.)

For meta-only fields such as source, last_status_change, external_refs, and implementation_refs, update the reef_issues.meta JSON and preserve existing unrelated meta keys.

Do not set updated_at yourself; AKB bumps it on any row UPDATE.

## Record a field-change activity event

reef_activity logs more than status. When an update changes the assignee, the priority, a planning link (milestone, sprint, or release), the title, the labels, the due date, the estimate, the parent, a relation (depends_on, blocks, or related_to), the archived state, or links a new delivery ref (a pull_request, commit, or branch in implementation_refs), you MUST ALSO append one immutable reef_activity row per change, in the same update -- the same append-only mechanism as the status_change rule below, just a different event_type. This is what populates the issue timeline with the full history, not status alone. Append:

INSERT INTO reef_activity (reef_id, event_type, event_key, payload, meta)
VALUES (
  'REEF-001',
  'assignee_change',
  'assignee_change:alice->bob@2026-06-15T07:34:38.237Z',
  '{"from":"alice","to":"bob"}'::json,
  '{"actor":"ACTOR","at":"2026-06-15T07:34:38.237Z","source":"ai-agent:user_request"}'::json);

- event_type is one of assignee_change, priority_change, planning_link, impl_ref_linked, title_change, labels_change, due_date_change, estimate_change, parent_change, relation_change, or archived_change.
- payload carries the change. The shape is one of three families:
  - {from,to} mutations -- assignee_change and priority_change (either side may be null: an unassigned issue or unset priority), title_change (both ends carry the title text -- a title is always set), due_date_change and parent_change (null on a set/clear or attach/detach; parent ids are plain reef ids), estimate_change (numbers, null when unset), and archived_change (booleans -- archive is false->true, restore is true->false).
  - {field,from,to} -- planning_link, where field is milestone, sprint, or release and from/to are the planning ids (null on attach/detach).
  - set changes (added/removed id collections) -- labels_change is {added,removed}; relation_change is {relation,added,removed} where relation is depends_on, blocks, or related_to. Emit one labels_change for the whole labels change and one relation_change per changed relation dimension; emit nothing for a dimension whose set is unchanged. impl_ref_linked is the set-addition special case: {ref_type,ref,repo} naming each newly-linked ref (ref_type is pull_request, commit, or branch; repo is owner/name or null), one event per newly-added ref and nothing when the refs array is unchanged.
- event_key is the idempotency key. The {from,to} family uses <event_type>:<from>-><to>@<at> (booleans render as false/true, numbers as their digits); planning_link uses planning_link:<field>:<from>-><to>@<at>; impl_ref_linked uses impl_ref_linked:<ref_type>:<repo>:<ref>@<at>; the set-change family uses <event_type>:+<sorted added joined by commas>:-<sorted removed>@<at>, and relation_change inserts the relation after the event_type: relation_change:<relation>:+<sorted added>:-<sorted removed>@<at>. Use the literal ∅ token for a null segment so an attach never collides with a value. Before inserting, skip the insert if a row with the same reef_id and event_key already exists.
- In meta, "at" is the update's timestamp (the same value you stamp on every field of this update), "actor" is the acting user, and "source" mirrors the change's provenance or is null. When one update changes several of these fields at once, every event shares that one "at" so they group as a single moment.
- Do NOT set id, created_by, created_at, or updated_at; AKB fills them. reef_activity is append-only -- never UPDATE or DELETE an event row. If an append fails after the row UPDATE already changed the field, leave the field change in place; do not roll it back over a missing history row.

## Status lifecycle

Statuses are ordered: backlog < todo < in_progress < in_review < done < closed. The normal path for a committed issue walks them in order:
  todo -> in_progress -> in_review -> done -> closed
A new issue lands in backlog by default; pull it forward into todo when committing to work on it. An issue may also be cancelled straight to closed from backlog, todo, in_progress, or in_review. closed is the end state.

A status change is normally a FORWARD move: the new status is later in that order than the current one. Stepping one at a time is the norm, but a forward jump is allowed when reality skips ahead -- for example a finished issue going straight to done, or a merged PR taking an in_progress issue to done. If a jump looks surprising (the issue still looks not-started), confirm the user means it before writing.

A BACKWARD move (reopen, or sending a review back to in_progress) is the deliberate exception covered in the Reopen section; confirm first.

A status change is a row-only update; it does not touch the document. On ANY status change you MUST also set, in the same update:
  - meta.last_status_change = current ISO timestamp
  - meta.last_editor = the acting user
When the new status is closed, also set closed_at and closed_reason (see Close). When the new status is anything other than closed (including done and any reopen), set closed_at = NULL and closed_reason = NULL so stale closure fields do not linger.

On ANY status change you MUST ALSO append one immutable event row to the reef_activity table, in addition to the reef_issues row update above. reef_activity is the issue's ordered audit history (the timeline reads it); meta.last_status_change on the row is only the last-event safety net, while reef_activity keeps every transition. Insert:

INSERT INTO reef_activity (reef_id, event_type, event_key, payload, meta)
VALUES (
  'REEF-001',
  'status_change',
  'status_change:in_progress->in_review@2026-06-15T07:34:38.237Z',
  '{"from":"in_progress","to":"in_review"}'::json,
  '{"actor":"ACTOR","at":"2026-06-15T07:34:38.237Z","source":"ai-agent:user_request"}'::json);

- event_key is the idempotency key: build it as status_change:<from>-><to>@<timestamp>, where <timestamp> is the SAME ISO value you wrote to meta.last_status_change. Before inserting, skip the insert if a row with the same reef_id and event_key already exists -- re-applying the same transition must never double the event.
- payload is the {from,to} transition. In meta, "at" MUST equal the meta.last_status_change you set on the issue row, "actor" is the acting user, and "source" mirrors the change's provenance (for example ai-agent:user_request) or is null.
- Do NOT set id, created_by, created_at, or updated_at; AKB fills them. reef_activity is append-only -- never UPDATE or DELETE an event row. If this append fails after the row UPDATE already changed the status, leave the status change in place (meta.last_status_change still records the latest move); do not roll the status back over a missing history row.

Timestamp format (load-bearing): write meta.last_status_change, closed_at, and every other ISO date field in full ISO-8601 UTC -- prefer the toISOString form with milliseconds and a Z suffix (2026-06-15T07:34:38.237Z), or at minimum an offset that includes minutes (2026-06-15T07:34:38+00:00). When you build the value in SQL, use to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'). Do NOT write a "+00" offset without minutes (for example now()::text, or to_char(..., '...+00')): that truncated tail fails ISO date parsing, the read path rejects the row, and the issue silently vanishes from the board and list (see "When the row is present but the board hides it").

The AKB backend does NOT enforce this ordering on a direct row update; it accepts any value (last write wins). These runbooks are the only guardrail, so apply the side effects above on every status change and keep moves forward unless the user explicitly wants a reopen.

## Mark done

When the user says "mark REEF-001 as done", set:

- status = 'done'
- closed_at = NULL and closed_reason = NULL (done is not closed)
- meta.last_status_change = current ISO timestamp
- meta.last_editor = current acting user for user-driven changes, or ai-agent for automated agent-originated changes
- meta.implementation_refs = the delivery ref for the PR/commit that finished the work, recorded in the same update (see "Record a delivery ref")

done is a forward move. If the issue is still in todo or only in_progress, marking it done skips steps; that is fine when the work really is finished, but confirm with the user if it seems surprising.

Do not set closed_at or closed_reason for "done" unless the user explicitly asks to close the issue.

## Record a delivery ref

A done -- and a close with reason completed -- is normally delivered by a merged PR or commit. Record it on the issue in the SAME update that changes status, so the issue's Delivery section is populated. The activity-scan approve path already does this automatically ("Approve a status change" in activity-inbox-workflows.md); manual completion and scan-approve completion must leave the same trace, so do not skip it here.

- When the user names the delivering PR/commit, or it is clear from the conversation, build an implementation_ref using the "Delivery links" shape: type pull_request for a PR or commit for a commit; ref is the PR number or commit SHA; repo is the owner/name the PR or commit lives in whenever it is known (from a pasted GitHub URL, or from monitored_repos when the workspace tracks a single repo) -- record it so the ref de-dupes against scan-approve refs, which always carry repo, and so PR numbers from different repos never collide; url is the GitHub link when known (https://github.com/{repo}/pull/{ref} for a PR, https://github.com/{repo}/commit/{ref} for a commit); title is the PR or commit title when known. actor and detected_at stay unset -- unlike scan evidence, a hand-recorded ref has no scan provenance.
- Merge into the issue's existing meta.implementation_refs, de-duplicating on type:repo:ref (fall back to type:ref only when the repo is genuinely unknowable) so re-recording the same PR never doubles an entry, and leave any unrelated refs already there untouched.
- If the issue is being completed but no delivering PR/commit is apparent, ask the user for the PR number rather than leaving the ref blank. A process or docs task that has no delivering artifact may skip the ref -- only the existence of a delivering PR/commit makes it required.

## Close an issue

When the user explicitly asks to close, cancel, reject, or mark duplicate, set:

- status = 'closed'
- closed_at = current ISO timestamp
- closed_reason = one of completed, duplicate, wont_fix, invalid, stale
- meta.last_status_change = current ISO timestamp
- meta.last_editor = current acting user for user-driven changes, or ai-agent for automated agent-originated changes
- meta.implementation_refs = when closed_reason is completed and a PR/commit delivered the work, the delivery ref, recorded in the same update (see "Record a delivery ref")

If the user asks to close an issue but does not provide a reason and the reason is not obvious from the request, ask for the closed_reason instead of inventing one.

## Reopen a closed or done issue

There is no separate reopen feature; reopen is a backward status move, which the forward lifecycle does not include. It is still possible because direct updates are last-write-wins and ungated. Because it is an exception, confirm with the user first, then:

- status = the active status they want; ask which if unclear (usually in_progress, sometimes todo)
- closed_at = NULL and closed_reason = NULL (clear the closure fields)
- meta.last_status_change = current ISO timestamp
- meta.last_editor = the acting user
`;
}
