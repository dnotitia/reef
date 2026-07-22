import { SchemaValidationError } from "../../../errors";
import {
  type AuthoringLanguage,
  AuthoringLanguageSchema,
} from "../../../schemas/workspace/authoringLanguage";
import {
  type Config,
  ConfigSchema,
  DEFAULT_CONFIG,
  DEFAULT_STALE_HIDE_CANCELED_DAYS,
  DEFAULT_STALE_HIDE_COMPLETED_DAYS,
  type MonitoredRepo,
  MonitoredRepoSchema,
  StaleHideDaysSchema,
} from "../../../schemas/workspace/config";
import type { AkbAdapter } from "../core/http";
import {
  type AkbSqlResponse,
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_AI_SCANNING_ENABLED_KEY,
  REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
  REEF_SETTINGS_PROJECT_PREFIX_KEY,
  REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
  REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
  REEF_SETTINGS_TABLE,
  decodeSettingsValue,
  isMissingTableError,
  quoteIntOrNull,
  quoteJson,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
  verifyWorkspaceSchema,
  withSpan,
} from "../core/shared";
import type {
  ReadConfigParams,
  ReadConfigResult,
  WriteConfigParams,
} from "../core/types";

// ─── Config functions ────────────────────────────────────────────────────────
//
// reef's workspace config is persisted in akb's structured-data tables, not
// in a markdown document. `reef_settings` is a key-value table whose
// `project_prefix` row holds the prefix; `monitored_repos` is a typed table
// of GitHub repos addressed by `github_id`.
//
// Tables are provisioned by explicit initialization/startup owners. Config
// reads/writes never repair schema from a feature request.
//
// Concurrency: writes are replace-all (DELETE + INSERT), non-transactional
// across statements. The brief window with empty rows is observable to a
// concurrent read. Acceptable for solo-dev pre-release; a future move to
// app-level diffing or akb-side transactions is left as a separate change.

async function deterministicInitializationRowId(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  // AKB's managed id is a UUID primary key. Derive a stable RFC 4122-shaped
  // value so concurrent/retried writes for one initialization fingerprint hit
  // the same row instead of creating duplicates.
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function upsertInitialSetting(
  adapter: AkbAdapter,
  vault: string,
  fingerprint: string,
  key: string,
  value: unknown,
): Promise<void> {
  const id = await deterministicInitializationRowId(
    `reef-workspace-initialization:${fingerprint}:setting:${key}`,
  );
  await runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (id, key, value) VALUES (${quoteText(
      id,
      "initialization row id",
    )}, ${quoteText(key, "settings key")}, ${quoteJson(
      value,
    )}) ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, value = EXCLUDED.value WHERE ${tableRef(
      REEF_SETTINGS_TABLE,
    )}.key = EXCLUDED.key`,
  );
}

/**
 * Idempotent initial projection for a workspace whose config was proven absent.
 *
 * Unlike routine Settings edits, this uses deterministic AKB-managed row ids
 * and primary-key upserts. Identical concurrent/restarted initialization
 * requests therefore converge without a process-local lock. This function must
 * not be used to replace an existing config because it intentionally performs
 * no destructive cleanup.
 */
export async function writeInitialConfig(params: {
  adapter: AkbAdapter;
  vault: string;
  config: Config;
  fingerprint: string;
}): Promise<void> {
  const { adapter, vault, config, fingerprint } = params;
  return withSpan("akb.write_initial_config", { vault }, async (span) => {
    span.setAttribute("write_strategy", "deterministic_id_upsert");
    span.setAttribute("monitored_repo_count", config.monitored_repos.length);
    await verifyWorkspaceSchema({ adapter, vault });

    const settings: ReadonlyArray<readonly [string, unknown]> = [
      [REEF_SETTINGS_PROJECT_PREFIX_KEY, config.project_prefix],
      [
        REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
        config.stale_hide_completed_days,
      ],
      [
        REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
        config.stale_hide_canceled_days,
      ],
      [REEF_SETTINGS_AI_SCANNING_ENABLED_KEY, config.ai_scanning_enabled],
    ];
    for (const [key, value] of settings) {
      await upsertInitialSetting(adapter, vault, fingerprint, key, value);
    }
    if (config.authoring_language != null) {
      await upsertInitialSetting(
        adapter,
        vault,
        fingerprint,
        REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
        config.authoring_language,
      );
    }

    for (const repo of config.monitored_repos) {
      const id = await deterministicInitializationRowId(
        `reef-workspace-initialization:${fingerprint}:repo:${repo.github_id}`,
      );
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(
          MONITORED_REPOS_TABLE,
        )} (id, github_id, owner, name, description) VALUES (${quoteText(
          id,
          "initialization row id",
        )}, ${quoteIntOrNull(repo.github_id)}, ${quoteText(
          repo.owner,
          "monitored_repo owner",
        )}, ${quoteText(repo.name, "monitored_repo name")}, ${quoteTextOrNull(
          repo.description,
          "monitored_repo description",
        )}) ON CONFLICT (id) DO UPDATE SET github_id = EXCLUDED.github_id, owner = EXCLUDED.owner, name = EXCLUDED.name, description = EXCLUDED.description WHERE ${tableRef(
          MONITORED_REPOS_TABLE,
        )}.github_id = EXCLUDED.github_id`,
      );
    }
  });
}

/**
 * Index `reef_settings` (key, value) rows by key, decoding each value. JSON/JSONB
 * columns round-trip through akb's SQL endpoint as the JSON text representation,
 * so a stored `"REEF"` (JSON string) comes back as the 6-character string
 * `"REEF"` (quotes included); `decodeSettingsValue` unwraps that, falling back to
 * the raw value if it's already a plain string (e.g. asyncpg auto-decoded).
 */
function indexSettingsRows(
  rows: Record<string, unknown>[],
): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const row of rows) {
    if (typeof row.key === "string") {
      map.set(row.key, decodeSettingsValue(row.value));
    }
  }
  return map;
}

function parseProjectPrefix(settings: Map<string, unknown>): string | null {
  const decoded = settings.get(REEF_SETTINGS_PROJECT_PREFIX_KEY);
  return typeof decoded === "string" ? decoded : null;
}

/**
 * Validate the stored authoring-language value against the supported set. An
 * unset key, or a stale/unknown code, both read as `null` (no language forced)
 * so a removed-from-support code degrades gracefully instead of failing the
 * whole config read.
 */
function parseAuthoringLanguage(
  settings: Map<string, unknown>,
): AuthoringLanguage | null {
  const decoded = settings.get(REEF_SETTINGS_AUTHORING_LANGUAGE_KEY);
  const parsed = AuthoringLanguageSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function parseStaleHideDays(
  settings: Map<string, unknown>,
  key: string,
  fallback: number,
): number {
  const decoded = settings.get(key);
  const parsed = StaleHideDaysSchema.safeParse(decoded);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Read the AI-scanning kill switch (REEF-313). An unset key — or any value that
 * is not the JSON boolean `true` — reads as `false`, so a missing row and a
 * stale/corrupt value both leave scanning off (the safe default for a switch
 * that gates writes into the shared activity inbox).
 */
function parseAiScanningEnabled(settings: Map<string, unknown>): boolean {
  return settings.get(REEF_SETTINGS_AI_SCANNING_ENABLED_KEY) === true;
}

function parseMonitoredRepoRow(raw: Record<string, unknown>): MonitoredRepo {
  const result = MonitoredRepoSchema.safeParse({
    github_id:
      typeof raw.github_id === "number" ? raw.github_id : Number(raw.github_id),
    owner: raw.owner,
    name: raw.name,
    description: raw.description ?? undefined,
  });
  if (!result.success) {
    throw new SchemaValidationError({
      issues: result.error.issues.map(
        (issue) =>
          `monitored_repos row: ${issue.path.join(".")}: ${issue.message}`,
      ),
    });
  }
  return result.data;
}

export async function readConfig(
  params: ReadConfigParams,
): Promise<ReadConfigResult> {
  const { adapter, vault } = params;
  return withSpan("akb.read_config", { vault }, async (span) => {
    let settingsResponse: AkbSqlResponse;
    let reposResponse: AkbSqlResponse;
    try {
      [settingsResponse, reposResponse] = await Promise.all([
        runSql(
          adapter,
          vault,
          `SELECT key, value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key IN (${quoteText(
            REEF_SETTINGS_PROJECT_PREFIX_KEY,
            "settings key",
          )}, ${quoteText(
            REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
            "settings key",
          )}, ${quoteText(
            REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
            "settings key",
          )}, ${quoteText(
            REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
            "settings key",
          )}, ${quoteText(
            REEF_SETTINGS_AI_SCANNING_ENABLED_KEY,
            "settings key",
          )})`,
        ),
        runSql(
          adapter,
          vault,
          `SELECT github_id, owner, name, description FROM ${tableRef(
            MONITORED_REPOS_TABLE,
          )}`,
        ),
      ]);
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("tables_exist", false);
        return { config: DEFAULT_CONFIG, exists: false };
      }
      throw err;
    }
    span.setAttribute("tables_exist", true);

    const settingsRows =
      settingsResponse.kind === "table_query" ? settingsResponse.items : [];
    const reposRows =
      reposResponse.kind === "table_query" ? reposResponse.items : [];

    const settings = indexSettingsRows(settingsRows);
    const projectPrefix = parseProjectPrefix(settings);
    if (projectPrefix == null) {
      span.setAttribute("project_prefix_row", false);
      return { config: DEFAULT_CONFIG, exists: false };
    }
    span.setAttribute("project_prefix_row", true);
    span.setAttribute("monitored_repo_count", reposRows.length);

    const config: Config = ConfigSchema.parse({
      project_prefix: projectPrefix,
      monitored_repos: reposRows.map(parseMonitoredRepoRow),
      authoring_language: parseAuthoringLanguage(settings),
      stale_hide_completed_days: parseStaleHideDays(
        settings,
        REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
        DEFAULT_STALE_HIDE_COMPLETED_DAYS,
      ),
      stale_hide_canceled_days: parseStaleHideDays(
        settings,
        REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
        DEFAULT_STALE_HIDE_CANCELED_DAYS,
      ),
      ai_scanning_enabled: parseAiScanningEnabled(settings),
    });
    return { config, exists: true };
  });
}

/**
 * Replace-all write of the workspace config.
 *
 * Requires a reconciled workspace schema. Explicit initialization and startup
 * own provisioning; ordinary Settings writes only verify the prerequisite.
 *
 * Single-row `reef_settings` upsert is implemented as DELETE+INSERT for
 * symmetry with the `monitored_repos` replace; both are non-transactional,
 * see file-header note.
 */
export async function writeConfig(params: WriteConfigParams): Promise<void> {
  const { adapter, vault, config } = params;
  return withSpan("akb.write_config", { vault }, async (span) => {
    span.setAttribute("write_strategy", "replace_all");
    span.setAttribute("monitored_repo_count", config.monitored_repos.length);

    await verifyWorkspaceSchema({ adapter, vault });

    // (1) Replace the project_prefix row in reef_settings.
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_PROJECT_PREFIX_KEY,
        "settings key",
      )}`,
    );
    await runSql(
      adapter,
      vault,
      // akb manages the auto-injected `updated_at` column itself; we just
      // write the user-defined (key, value) pair.
      `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
        REEF_SETTINGS_PROJECT_PREFIX_KEY,
        "settings key",
      )}, ${quoteJson(config.project_prefix)})`,
    );

    // (2) Replace the authoring_language row. Unset (null) is the ABSENCE of the
    // row, so consistently DELETE and just INSERT when a language is configured —
    // matching the readConfig contract where a missing row reads as null.
    span.setAttribute(
      "authoring_language",
      config.authoring_language ?? "(unset)",
    );
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
        "settings key",
      )}`,
    );
    if (config.authoring_language != null) {
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
          REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
          "settings key",
        )}, ${quoteJson(config.authoring_language)})`,
      );
    }

    // (3) Replace resolved-issue auto-hide window rows.
    span.setAttribute(
      "stale_hide_completed_days",
      config.stale_hide_completed_days,
    );
    span.setAttribute(
      "stale_hide_canceled_days",
      config.stale_hide_canceled_days,
    );
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
        "settings key",
      )}`,
    );
    await runSql(
      adapter,
      vault,
      `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
        REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
        "settings key",
      )}, ${quoteJson(config.stale_hide_completed_days)})`,
    );
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
        "settings key",
      )}`,
    );
    await runSql(
      adapter,
      vault,
      `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
        REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
        "settings key",
      )}, ${quoteJson(config.stale_hide_canceled_days)})`,
    );

    // (4) Replace the ai_scanning_enabled row (REEF-313). Unlike
    // authoring_language, this boolean setting is represented by an explicit
    // DELETE + INSERT row update instead of using row absence for one state.
    span.setAttribute("ai_scanning_enabled", config.ai_scanning_enabled);
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_AI_SCANNING_ENABLED_KEY,
        "settings key",
      )}`,
    );
    await runSql(
      adapter,
      vault,
      `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
        REEF_SETTINGS_AI_SCANNING_ENABLED_KEY,
        "settings key",
      )}, ${quoteJson(config.ai_scanning_enabled)})`,
    );

    // (5) Replace all monitored_repos rows.
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(MONITORED_REPOS_TABLE)}`,
    );
    if (config.monitored_repos.length > 0) {
      const valuesClause = config.monitored_repos
        .map((repo) => {
          const parts = [
            quoteIntOrNull(repo.github_id),
            quoteText(repo.owner, "monitored_repo owner"),
            quoteText(repo.name, "monitored_repo name"),
            quoteTextOrNull(repo.description, "monitored_repo description"),
          ];
          return `(${parts.join(", ")})`;
        })
        .join(", ");
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(MONITORED_REPOS_TABLE)} (github_id, owner, name, description) VALUES ${valuesClause}`,
      );
    }
  });
}

/**
 * Read the workspace default authoring language (REEF-136), as a single
 * `reef_settings` lookup — the lean read path for AI generation, which needs the
 * language but not `project_prefix` or `monitored_repos`. Returns `null` when
 * the key is unset, the value is unknown/stale, or the tables don't exist yet,
 * so a generation path with no configured language keeps its prior
 * behavior. does not throws on a missing table.
 */
export async function readAuthoringLanguage(
  params: ReadConfigParams,
): Promise<AuthoringLanguage | null> {
  const { adapter, vault } = params;
  return withSpan("akb.read_authoring_language", { vault }, async (span) => {
    let response: AkbSqlResponse;
    try {
      response = await runSql(
        adapter,
        vault,
        `SELECT key, value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
          REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
          "settings key",
        )} LIMIT 1`,
      );
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("tables_exist", false);
        return null;
      }
      throw err;
    }
    const rows = response.kind === "table_query" ? response.items : [];
    const language = parseAuthoringLanguage(indexSettingsRows(rows));
    span.setAttribute("authoring_language", language ?? "(unset)");
    return language;
  });
}
