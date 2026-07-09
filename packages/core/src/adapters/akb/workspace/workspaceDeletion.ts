import { NotFoundError } from "../../../errors";
import {
  ACTIVITY_INBOX_COLLECTION,
  REEF_ATTACHMENTS_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_TABLE_NAMES,
} from "../core/constants";
import { deleteCollection, deleteDocument } from "../core/documents";
import { deleteAkbFile } from "../core/files";
import type { AkbAdapter } from "../core/http";
import { issuePathFor } from "../core/paths";
import { isMissingTableError, runSql, tableRef } from "../core/sql";
import { dropAkbTable } from "../core/tables";
import { withSpan } from "../core/tracing";
import type { DeleteVaultParams, DetachReefParams } from "../core/types";
import { listIssues } from "../issues/issues";
import { buildReefVaultSkillDocuments } from "../vaultSkill/documents";

/**
 * Run a teardown step, treating "already gone" (404 → NotFoundError) as success
 * so a partially-completed detach is safe to retry. Any other failure (auth,
 * conflict, upstream) still propagates.
 */
async function ignoreMissing(step: Promise<void>): Promise<void> {
  try {
    await step;
  } catch (err) {
    if (err instanceof NotFoundError) return;
    throw err;
  }
}

/**
 * The akb-relative paths of reef's own issue documents, addressed by their
 * deterministic id→path mapping. Detach deletes these specific documents rather
 * than recursively deleting the `issues/` collection, whose name is not
 * reef-private and could also hold the team's own documents in a brownfield
 * vault — recursively deleting it would destroy non-reef content the feature
 * promises to keep (REEF-322). A missing `reef_issues` table (a retry after the
 * drop) yields no paths.
 */
async function reefIssueDocumentPaths(
  adapter: AkbAdapter,
  vault: string,
): Promise<string[]> {
  try {
    const { issues } = await listIssues({ adapter, vault });
    return issues.map((issue) => issuePathFor(issue.id));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function reefAttachmentFileUris(
  adapter: AkbAdapter,
  vault: string,
): Promise<string[]> {
  try {
    const res = await runSql(
      adapter,
      vault,
      `SELECT DISTINCT file_uri FROM ${tableRef(REEF_ATTACHMENTS_TABLE)}`,
    );
    if (res.kind !== "table_query") return [];
    return res.items
      .map((row) => row.file_uri)
      .filter((uri): uri is string => typeof uri === "string" && uri !== "");
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/**
 * Permanently delete an entire akb vault — documents, tables, files, and git
 * history — via `DELETE /api/v1/vaults/{vault}` (akb requires admin/owner). This
 * is irreversible; the typed-name confirmation gate lives with the caller
 * (REEF-322). The acting user is recorded on the span BEFORE the request so the
 * audit trail survives even though the vault's own `reef_activity` is destroyed
 * by the delete (AC5).
 */
export async function deleteVault(params: DeleteVaultParams): Promise<void> {
  const { adapter, vault, actor } = params;
  return withSpan("akb.delete_vault", { vault, actor }, async () => {
    await adapter.request(`/api/v1/vaults/${encodeURIComponent(vault)}`, {
      method: "DELETE",
      resource: `vault ${vault}`,
    });
  });
}

/**
 * Remove the reef layer from a vault while leaving the akb vault and any
 * non-reef content intact (REEF-322 detach).
 *
 * Documents are deleted by reef ownership rather than by recursively clearing a
 * collection that could also hold the team's own content:
 *  - issue documents — by their deterministic id→path (reef's docs in the
 *    shared-name `issues/` collection);
 *  - vault-skill documents — by the exact paths reef installed;
 *  - the AI activity inbox — recursively, because it lives under reef's private
 *    `_reef/` namespace, which does not hold non-reef documents.
 *
 * Then every reef table is dropped, `reef_settings` LAST so `has_reef_config`
 * flips to false once the rest of the teardown has already succeeded. Every
 * step is idempotent (a 404 / missing table means already gone), so a failed run
 * is safe to retry. The acting user is recorded on the span for the audit trail
 * (AC5).
 */
export async function detachReef(params: DetachReefParams): Promise<void> {
  const { adapter, vault, actor } = params;
  return withSpan("akb.detach_reef", { vault, actor }, async () => {
    // 1. reef-owned documents (issue docs by id, vault-skill docs by exact path).
    const skillPaths = buildReefVaultSkillDocuments(vault).map(
      (doc) => doc.path,
    );
    const issuePaths = await reefIssueDocumentPaths(adapter, vault);
    await Promise.all(
      [...skillPaths, ...issuePaths].map((path) =>
        ignoreMissing(deleteDocument(adapter, vault, path)),
      ),
    );
    // The activity inbox is reef-private (`_reef/`), so the whole collection is
    // safe to sweep recursively.
    await ignoreMissing(
      deleteCollection(adapter, vault, ACTIVITY_INBOX_COLLECTION, true),
    );

    // 2. reef-owned attachment files, while the table still holds their URIs.
    const attachmentFileUris = await reefAttachmentFileUris(adapter, vault);
    await Promise.all(
      attachmentFileUris.map((uri) =>
        ignoreMissing(deleteAkbFile(adapter, vault, uri)),
      ),
    );

    // 3. reef tables, settings last (see doc comment).
    const nonSettings = REEF_TABLE_NAMES.filter(
      (table) => table !== REEF_SETTINGS_TABLE,
    );
    await Promise.all(
      nonSettings.map((table) =>
        ignoreMissing(dropAkbTable(adapter, vault, table)),
      ),
    );
    await ignoreMissing(dropAkbTable(adapter, vault, REEF_SETTINGS_TABLE));
  });
}
