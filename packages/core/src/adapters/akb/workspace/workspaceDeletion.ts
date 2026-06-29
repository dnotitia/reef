import { NotFoundError } from "../../../errors";
import {
  ACTIVITY_INBOX_COLLECTION,
  ISSUES_COLLECTION,
  REEF_SETTINGS_TABLE,
  REEF_TABLE_NAMES,
} from "../core/constants";
import { deleteCollection, deleteDocument } from "../core/documents";
import { dropAkbTable } from "../core/tables";
import { withSpan } from "../core/tracing";
import type { DeleteVaultParams, DetachReefParams } from "../core/types";

/**
 * akb collections that hold ONLY reef-owned documents, so the whole collection
 * is safe to delete recursively:
 *  - `issues`               — issue documents (the `reef_issues` projection)
 *  - `_reef/activity-inbox` — AI activity-inbox documents (reef-private `_reef/`)
 *  - `overview/reef`        — the vault-skill runbook sub-collection
 *
 * The root vault-skill document at `overview/vault-skill.md` is handled
 * separately: `overview/` is a generic akb collection that may also hold the
 * team's own documents, so detach removes only that one reef doc by id, never
 * the whole `overview/` collection.
 */
const REEF_DOCUMENT_COLLECTIONS: readonly string[] = [
  ISSUES_COLLECTION,
  ACTIVITY_INBOX_COLLECTION,
  "overview/reef",
];

/** The one reef-owned document living in the shared `overview/` collection. */
const REEF_ROOT_SKILL_DOC = "overview/vault-skill.md";

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
 * non-reef content intact (REEF-322 detach). Deletes reef's document
 * collections and the root vault-skill doc, then drops every reef table —
 * `reef_settings` LAST, so `has_reef_config` only flips to false once the rest
 * of the teardown has already succeeded. Every step is idempotent (a 404 means
 * already gone), so a failed run is safe to retry. The acting user is recorded
 * on the span for the audit trail (AC5).
 */
export async function detachReef(params: DetachReefParams): Promise<void> {
  const { adapter, vault, actor } = params;
  return withSpan("akb.detach_reef", { vault, actor }, async () => {
    // 1. reef document collections + the single root vault-skill doc.
    await Promise.all(
      REEF_DOCUMENT_COLLECTIONS.map((collection) =>
        ignoreMissing(deleteCollection(adapter, vault, collection, true)),
      ),
    );
    await ignoreMissing(deleteDocument(adapter, vault, REEF_ROOT_SKILL_DOC));

    // 2. reef tables, settings last (see doc comment).
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
