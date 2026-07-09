# Jira Migration

## Jira Rank To Reef Ordering

REEF-393 maps Jira Rank's current value into reef's existing
`reef_issues.rank` column. The column is now the issue-wide numeric ordering
scalar: lower numbers sort earlier, and `NULL` sorts at the ordered tail.

This does not make `rank` a normal user-authored issue field. The product UI
writes it only through backlog drag-to-reorder, and generic issue create/update
schemas still reject caller-supplied rank. Trusted importers, including the
SHDEV Jira migrator, may seed `rank` while creating imported issues.

The SHDEV mapping policy is:

- Sort distinct, non-empty Jira Rank strings lexicographically.
- Assign sparse reef ranks in that order using `RANK_STEP` gaps.
- Preserve the original Jira Rank string in Jira provenance under
  `custom_fields.jira.rank`.
- Classify missing or duplicate Jira Rank values as `rank_unmapped` in dry-run
  and apply reports, and do not invent a reef rank for them.

Issue list and board defaults do not change. The board/list landing views keep
their existing status, priority, sprint, and user-selected sorting behavior.
The query layer may still accept `sort_field=rank` for internal consumers,
backlog order, import verification, and future explicit issue-wide ordering
surfaces. Backlog remains `status=backlog` plus ascending `rank`.

Jira Rank changelog history reconstruction is out of scope. REEF-393 preserves
the current Jira ordering only.
