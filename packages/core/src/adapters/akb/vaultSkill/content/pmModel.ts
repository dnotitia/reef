export function pmModelContent(vault: string): string {
  return `# Reef PM Data Model

This vault, ${vault}, stores Reef PM work as AKB documents plus AKB tables.

## Core tables

- reef_settings: key-value workspace settings. The project_prefix row stores the issue prefix.
- monitored_repos: GitHub repositories watched by this workspace.
- reef_issues: queryable issue projection used by board, list, reports, and agents.
- reef_sprints: sprint metadata.
- reef_milestones: milestone metadata.
- reef_releases: release metadata.
- reef_activity_suggestions: AI activity inbox projection.
- reef_templates: issue templates.
- reef_comments: per-issue discussion thread (one row per comment).
- reef_activity: per-issue immutable activity/audit log (one row per recorded change).

## Querying Reef tables with akb_sql

- akb_sql runs data statements only: SELECT, INSERT, UPDATE, DELETE. It does NOT run DDL, SHOW, or information_schema queries, so you cannot introspect columns at runtime. Use the column manifest below as the source of truth.
- Reference table names bare and lowercase (reef_issues, reef_sprints, ...). AKB rewrites the friendly name to the physical table. A double-quoted "reef_issues" skips the rewrite and errors with relation does not exist.
- Column names may be double-quoted. Values are not parameterized: escape a single quote by doubling it, and write a JSON value as a quoted string cast to json, for example '[]'::json.

## reef_issues columns

Required on every INSERT (no default, NOT NULL): document_uri, reef_id, title, status, issue_type.

Optional columns: priority, assigned_to, requester, reporter, start_date, due_date, milestone_id, sprint_id, release_id, estimate_points (number), severity, rank (number), closed_at, closed_reason, parent_id, labels (json), depends_on (json), related_to (json), blocks (json), archived_at, meta (json).

severity is for bugs and uses blocker, critical, major, minor, trivial; it describes impact and is distinct from priority, which describes urgency. requester records who asked for the work; set it per the Requester rule in conversational-playbook.md (a conversational create defaults it to the acting user). reporter, start_date, due_date, estimate_points, and archived_at are not used by the current write flows; do not set them unless a future runbook introduces that workflow. rank is reef's issue-wide numeric ordering scalar: lower values sort earlier, NULL sorts at the ordered tail, the product UI writes it only through backlog drag-to-reorder, and trusted importers may seed it from source-system current order (for example Jira Rank). Never hand-author rank through conversational create or generic field update; a normal new issue gets product/backlog defaults rather than a caller-provided rank.

AKB manages id, created_at, updated_at, and created_by automatically. Never set them. Any UPDATE on the row bumps updated_at for free, so a plain SQL UPDATE is enough to record a change.

The reef_issues row is the source of truth for status and every queryable field. A document without a matching row is invisible to the board.

## reef_comments columns

reef_comments stores an issue's discussion thread, one row per comment. Columns:

- reef_id: the issue the comment belongs to.
- body: the comment's markdown text.
- meta (json): {author, created_at, edited_at}. author is the reef-semantic actor (akb username) who wrote the comment; created_at is the ISO-8601 write time and the thread's sort key; edited_at is the ISO-8601 of the last body edit, or null when never edited. As with reef_issues, the author and timestamps live in meta -- NOT in akb's auto created_by/created_at columns.

AKB manages id (the comment's uuid), created_at, updated_at, and created_by automatically; never set them. See comments-and-activity.md for the read, write, and edit procedures.

## reef_activity columns

reef_activity is an issue's immutable, append-only audit history, one row per recorded change (the board timeline reads it). Columns:

- reef_id: the issue the event belongs to.
- event_type: which kind of change -- status_change, assignee_change, priority_change, planning_link, or impl_ref_linked.
- event_key: the idempotency key, so the same logical change retried does not double a row.
- payload (json): event-specific data, for example {from,to} for a status_change. The exact shape per event_type is in comments-and-activity.md.
- meta (json): {actor, at, source}. actor is the reef-semantic actor who caused the event; at is the ISO-8601 event time and sort key; source is the trigger provenance or null. As with reef_comments, these live in meta, not akb's auto columns.

Append-only: rows are written only as a side effect of a lifecycle change (see issue-workflows.md) and are never updated or deleted. See comments-and-activity.md to read the timeline.

## Identifiers and paths

- A reef id is uppercase, for example REEF-001. The AKB document title is pinned to the uppercase reef id so the path is deterministic. Store the human-readable title in the document summary and the reef_issues.title column.
- The document slug and path are the lowercased id: issues/reef-001.md. Do not assume the path preserves case. Always address a document by the akb:// URI returned by akb_put rather than a hand-built path.
- project_prefix in reef_settings is stored JSON-encoded. The value column holds the JSON string "REEF" (with quotes). Decode it (JSON parse, or strip the quotes) before building an id.

## Issues

A Reef issue has two required parts:

1. An AKB document under issues/{reef_id}.md (the slug is lowercase).
2. A reef_issues table row with the same reef_id and a document_uri pointing at the document.

The issue document carries the markdown body and AKB-native fields such as summary, tags, depends_on, and related_to. The reef_issues row carries status, nullable priority, planning links, nullable assignee fields, and Reef metadata.

If either part is missing, the issue is not a complete Reef issue.

## Issue types

Use issue_type values: epic, story, task, bug, spike, chore. This is the reef_issues.issue_type column. It is NOT the AKB document type: every reef issue, whatever its issue_type, is stored as an AKB document of type task (the AKB document-type enum has no bug/epic/etc., so passing one is rejected). Never pass the issue_type as the akb_put type parameter.

- epic: a large outcome that can contain stories or tasks.
- story: user-visible product work.
- task: implementation or operations work.
- bug: incorrect behavior.
- spike: research or investigation.
- chore: maintenance work.

## Relationships

- parent_id points to another issue, usually epic to story or task.
- depends_on lists issues that must be completed first.
- blocks lists issues blocked by this issue.
- related_to is a weak association.
- sprint_id points to reef_sprints.id.
- milestone_id points to reef_milestones.id.
- release_id points to reef_releases.id.

## Relationship representation

- All relationship values are reef ids as plain strings, for example REEF-002. They are NOT akb:// URIs. Do not translate them.
- The reef_issues row is the source of truth and keeps four separate json-array columns: labels, depends_on, related_to, and blocks. Reads come from the row.
- The AKB document carries only depends_on and related_to (plus tags, which mirror labels). blocks has no document field of its own: it is folded into the document's related_to as the deduped union of blocks and related_to. Never rely on the document to recover blocks; read the row.

## The meta column

The reef_issues.meta json column is the home for Reef semantic actors (author, last_editor) and reef-only fields that have no native column. Its exact key set and skeleton are in issue-workflows.md.

## Delivery links

Reef issue delivery links are split into two fields:

- implementation_refs: delivery activity such as pull requests, commits, and branches. Types are pull_request, commit, and branch.
- external_refs: PM-facing external references such as GitHub issues, Linear tickets, Slack threads, Jira issues, Confluence pages, generic URLs, or other links. Types are github_issue, linear, slack, jira, confluence, url, and other. For akb documents, use first-class references relation edges, not external_refs.

In the Reef UI, implementation_refs appear under "Delivery activity" and external_refs appear under "External references". external_refs can be added while creating or editing an issue. implementation_refs are normally recorded from GitHub activity scans, but may also be added manually while editing an issue. Both live in the reef_issues.meta JSON.
`;
}
