import { ConflictError, NotFoundError } from "../../../errors";
import {
  type StoredVaultSkill,
  StoredVaultSkillSchema,
  type VaultSkillStatus,
} from "../../../schemas/workspace/vaultSkill";
import {
  type AkbAdapter,
  type AkbSqlResponse,
  REEF_SETTINGS_TABLE,
  REEF_SETTINGS_VAULT_SKILL_KEY,
  decodeSettingsValue,
  ensureDocumentPutResponse,
  isMissingTableError,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  verifyWorkspaceSchema,
  withSpan,
} from "../core/shared";
import {
  type ReefVaultSkillDocument,
  buildReefVaultSkillDocuments,
} from "./documents";
import { REEF_VAULT_SKILL_VERSION } from "./version";

export { buildReefVaultSkillDocuments, type ReefVaultSkillDocument };
export { REEF_VAULT_SKILL_VERSION } from "./version";

export interface InstallReefVaultSkillParams {
  adapter: AkbAdapter;
  vault: string;
}

export interface GetVaultSkillStatusParams {
  adapter: AkbAdapter;
  vault: string;
}

function updateBody(doc: ReefVaultSkillDocument): Record<string, unknown> {
  return {
    title: doc.title,
    content: doc.content,
    type: doc.type,
    summary: doc.summary,
    tags: doc.tags,
    message: `docs(reef): install ${doc.path} [reef-agent]`,
  };
}

function putBody(
  vault: string,
  doc: ReefVaultSkillDocument,
): Record<string, unknown> {
  return {
    vault,
    collection: doc.collection,
    title: doc.title,
    slug: doc.slug,
    content: doc.content,
    type: doc.type,
    summary: doc.summary,
    tags: doc.tags,
  };
}

async function patchDocument(
  adapter: AkbAdapter,
  vault: string,
  doc: ReefVaultSkillDocument,
): Promise<void> {
  const payload = await adapter.request(
    `/api/v1/documents/${encodeURIComponent(vault)}/${doc.path}`,
    {
      method: "PATCH",
      body: updateBody(doc),
      resource: doc.path,
    },
  );
  ensureDocumentPutResponse(payload);
}

async function putDocument(
  adapter: AkbAdapter,
  vault: string,
  doc: ReefVaultSkillDocument,
): Promise<void> {
  const payload = await adapter.request("/api/v1/documents", {
    method: "POST",
    body: putBody(vault, doc),
    resource: doc.path,
  });
  ensureDocumentPutResponse(payload);
}

async function upsertDocument(
  adapter: AkbAdapter,
  vault: string,
  doc: ReefVaultSkillDocument,
): Promise<void> {
  try {
    await patchDocument(adapter, vault, doc);
    return;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  try {
    await putDocument(adapter, vault, doc);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    await patchDocument(adapter, vault, doc);
  }
}

/**
 * Record the installed skill version in `reef_settings` as a single
 * `vault_skill` row (DELETE+INSERT upsert, mirroring `writeConfig`'s
 * `project_prefix` write). Schema lifecycle owners provision first; this
 * feature path verifies the prerequisite without mutating schema. The `synced_at` ISO
 * timestamp is JS-side (`…T…Z`), not akb's `now()::text`, so it round-trips
 * cleanly through display.
 */
export async function stampReefVaultSkillVersion(
  adapter: AkbAdapter,
  vault: string,
): Promise<StoredVaultSkill> {
  const stamp: StoredVaultSkill = {
    version: REEF_VAULT_SKILL_VERSION,
    synced_at: new Date().toISOString(),
  };
  await verifyWorkspaceSchema({ adapter, vault });
  await runSql(
    adapter,
    vault,
    `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
      REEF_SETTINGS_VAULT_SKILL_KEY,
      "settings key",
    )}`,
  );
  await runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
      REEF_SETTINGS_VAULT_SKILL_KEY,
      "settings key",
    )}, ${quoteJson(stamp)})`,
  );
  return stamp;
}

/**
 * Read the stored `vault_skill` stamp, or `null` when the vault has not been
 * stamped (older onboarding, or tables not provisioned yet) or the stored
 * value is unparseable. A `null` reads downstream as "not up to date", so the
 * first re-apply backfills the row.
 */
async function readInstalledVaultSkill(
  adapter: AkbAdapter,
  vault: string,
): Promise<StoredVaultSkill | null> {
  let response: AkbSqlResponse;
  try {
    response = await runSql(
      adapter,
      vault,
      `SELECT value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_VAULT_SKILL_KEY,
        "settings key",
      )} LIMIT 1`,
    );
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
  const rows = response.kind === "table_query" ? response.items : [];
  const row = rows[0];
  if (!row) return null;
  const parsed = StoredVaultSkillSchema.safeParse(
    decodeSettingsValue(row.value),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Install (or re-apply) the Reef PM vault-skill documents, then stamp the
 * installed version. Idempotent: every document is upserted, and the version
 * row is written last so a partial failure leaves the prior stamp and a retry
 * converges. This is the single write path for both vault creation and the
 * Settings "update instructions" action.
 */
export async function installReefVaultSkillDocuments(
  params: InstallReefVaultSkillParams,
): Promise<void> {
  const { adapter, vault } = params;
  return withSpan("akb.install_reef_vault_skill", { vault }, async (span) => {
    const docs = buildReefVaultSkillDocuments(vault);
    span.setAttribute("document_count", docs.length);
    for (const doc of docs) {
      await upsertDocument(adapter, vault, doc);
    }
  });
}

export async function installReefVaultSkill(
  params: InstallReefVaultSkillParams,
): Promise<void> {
  await installReefVaultSkillDocuments(params);
  await stampReefVaultSkillVersion(params.adapter, params.vault);
}

/**
 * Compare the vault's stamped skill version against the running release's
 * `REEF_VAULT_SKILL_VERSION`. `up_to_date` is derived here so the client does not
 * re-implements the comparison; a does not-stamped vault reports
 * `installed_version: null` (not up to date).
 */
export async function getVaultSkillStatus(
  params: GetVaultSkillStatusParams,
): Promise<VaultSkillStatus> {
  const { adapter, vault } = params;
  return withSpan("akb.get_vault_skill_status", { vault }, async (span) => {
    const installed = await readInstalledVaultSkill(adapter, vault);
    const installedVersion = installed?.version ?? null;
    // An update is offered when the stamp is missing or OLDER than the
    // running release. A vault stamped by a NEWER deployment (a mixed-version
    // rollout, or a revert that left a newer stamp behind) is reported up to
    // date so the Settings UI does not offers to overwrite newer skill docs with
    // this older release's defaults — that would be a downgrade. Hence `>=`,
    // not strict equality.
    const upToDate =
      installedVersion != null && installedVersion >= REEF_VAULT_SKILL_VERSION;
    span.setAttribute("installed_version", installedVersion ?? -1);
    span.setAttribute("up_to_date", upToDate);
    return {
      installed_version: installedVersion,
      current_version: REEF_VAULT_SKILL_VERSION,
      up_to_date: upToDate,
      synced_at: installed?.synced_at ?? null,
    };
  });
}
