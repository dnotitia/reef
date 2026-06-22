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
import {
  type AkbSqlResponse,
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
  REEF_SETTINGS_PROJECT_PREFIX_KEY,
  REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
  REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
  REEF_SETTINGS_TABLE,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  quoteIntOrNull,
  quoteJson,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
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
// The akb tables themselves are created lazily by `ensureReefTables` from the
// `POST /api/vaults` route. `writeConfig` assumes they already exist and will
// fail loudly if they don't — auto-healing on write would mask corruption.
//
// Concurrency: writes are replace-all (DELETE + INSERT), non-transactional
// across statements. The brief window with empty rows is observable to a
// concurrent read. Acceptable for solo-dev pre-release; a future move to
// app-level diffing or akb-side transactions is left as a separate change.

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
    });
    return { config, exists: true };
  });
}

/**
 * Replace-all write of the workspace config.
 *
 * Calls `ensureReefTables` lazily so both entry points — `POST /api/vaults`
 * (greenfield + brownfield onboarding) and `PATCH /api/config` (Settings
 * editing a does not-configured workspace) — provision the tables uniformly.
 * `ensureReefTables` is idempotent (listTables first), so the redundant call
 * during onboarding costs one extra round-trip but does not duplicates work.
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

    await ensureReefTables({ adapter, vault });

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

    // (4) Replace all monitored_repos rows.
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
