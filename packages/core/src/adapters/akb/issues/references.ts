import {
  type AkbDocumentReference,
  ISSUE_REFERENCE_RELATION,
} from "../../../schemas/issues/references";
import { issueDocumentUri, makeIssueResourceLabel } from "../core/paths";
import {
  getResourceRelations,
  linkResources,
  unlinkResources,
} from "../core/relations";
import { type AkbAdapter, withSpan } from "../core/shared";

/**
 * The akb-native `references` edges pointing OUT of an issue's document — the
 * documents this issue cites. Read projection for the issue detail's
 * Linked documents section; `title` falls back to null when akb could not
 * resolve a same-vault name (does not expected for reef-created edges).
 */
export async function listIssueReferences(
  adapter: AkbAdapter,
  vault: string,
  issueId: string,
): Promise<AkbDocumentReference[]> {
  return withSpan("akb.list_issue_references", { vault }, async (span) => {
    const edges = await getResourceRelations(adapter, {
      uri: issueDocumentUri(vault, issueId),
      relation: ISSUE_REFERENCE_RELATION,
      direction: "outgoing",
    });
    // `references` is a generic akb relation that can point at tables/files too;
    // surface just document targets so the Linked documents UI does not shows a
    // non-document card (which the add/remove routes reject anyway).
    const documents = edges
      .filter((edge) => edge.resource_type === "doc")
      .map((edge) => ({
        uri: edge.uri,
        title: edge.name ?? null,
        resource_type: edge.resource_type,
      }));
    span.setAttribute("reference_count", documents.length);
    return documents;
  });
}

/** Create an issue → document `references` edge (idempotent on the akb side). */
export async function addIssueReference(
  adapter: AkbAdapter,
  vault: string,
  issueId: string,
  targetUri: string,
): Promise<void> {
  await withSpan(
    "akb.add_issue_reference",
    { vault, resource: makeIssueResourceLabel(issueId) },
    async () => {
      await linkResources(adapter, {
        source: issueDocumentUri(vault, issueId),
        target: targetUri,
        relation: ISSUE_REFERENCE_RELATION,
      });
    },
  );
}

/** Remove a single issue → document `references` edge. */
export async function removeIssueReference(
  adapter: AkbAdapter,
  vault: string,
  issueId: string,
  targetUri: string,
): Promise<void> {
  await withSpan(
    "akb.remove_issue_reference",
    { vault, resource: makeIssueResourceLabel(issueId) },
    async () => {
      await unlinkResources(adapter, {
        source: issueDocumentUri(vault, issueId),
        target: targetUri,
        relation: ISSUE_REFERENCE_RELATION,
      });
    },
  );
}
