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

The board's pristine order uses `rank ASC` inside each workflow column, so Jira
Rank seeded by the migrator is visible on the Kanban board without making
`rank` user-selectable. Explicit board/list user sorts still use the existing
shared sort control, and the issue list keeps its priority-based default. The
query layer accepts `sort_field=rank` for the board's pristine order, backlog
order, import verification, and other internal consumers. Backlog remains
`status=backlog` plus ascending `rank`.

Jira Rank changelog history reconstruction is out of scope. REEF-393 preserves
the current Jira ordering only.
