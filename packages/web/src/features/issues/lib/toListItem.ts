import type { IssueListItem, IssueMetadata } from "@reef/core";

/**
 * Project a full `IssueMetadata` (e.g. the detail document's `issue`, or a
 * mutation response) down to the `IssueListItem` shape the board/list render
 * from. Strips the metadata-only fields that are not part of the list mask
 * (`IssueListItemSchema` in core) so a detail/mutation payload can feed the
 * same normalized entity store and list caches the list endpoint feeds.
 *
 * Shared by the issue-list mutations and the entity-store normalizer so the
 * two never drift on which fields a list item carries.
 */
export function toListItem(issue: IssueMetadata): IssueListItem {
  const {
    source: _source,
    external_refs: _externalRefs,
    implementation_refs: _implementationRefs,
    watchers: _watchers,
    reviewers: _reviewers,
    qa_owner: _qaOwner,
    custom_fields: _customFields,
    ...item
  } = issue;
  return item;
}
