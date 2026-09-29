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
  type AkbAdapter,
  type AkbSqlResponse,
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
  REEF_SETTINGS_PROJECT_PREFIX_KEY,
  REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
  REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
  REEF_SETTINGS_TABLE,
  decodeSettingsValue,
  isMissingTableError,
  SqlParameterBuilder,
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
// AKB's canonical app installation owns these tables. `writeConfig` assumes
// they already exist and fails if they don't; Reef data initialization only
// adds missing default rows after AKB reports the installation active.
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

async function runConfigSql(
  adapter: AkbAdapter,
  vault: string,
  buildSql: (params: SqlParameterBuilder) => string,
): Promise<AkbSqlResponse> {
  const params = new SqlParameterBuilder();
  return runSql(adapter, vault, buildSql(params), params.params);
}

export async function readConfig(
  params: ReadConfigParams,
): Promise<ReadConfigResult> {
  const { adapter, vault } = params;
  return withSpan("akb.read_config", { vault }, async (span) => {
    let settingsResponse: AkbSqlResponse;
    let reposResponse: AkbSqlResponse;
    try {
      const settingsParams = new SqlParameterBuilder();
      [settingsResponse, reposResponse] = await Promise.all([
        runSql(
          adapter,
          vault,
          `SELECT key, value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key IN (${settingsParams.add(
            REEF_SETTINGS_PROJECT_PREFIX_KEY,
            "settings key",
          )}, ${settingsParams.add(
            REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
            "settings key",
          )}, ${settingsParams.add(
            REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
            "settings key",
          )}, ${settingsParams.add(
            REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
            "settings key",
          )})`,
          settingsParams.params,
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
 * Single-row `reef_settings` upsert is implemented as DELETE+INSERT for
 * symmetry with the `monitored_repos` replace; both are non-transactional,
 * see file-header note.
 */
export async function writeConfig(params: WriteConfigParams): Promise<void> {
  const { adapter, vault, config } = params;
  return withSpan("akb.write_config", { vault }, async (span) => {
    span.setAttribute("write_strategy", "replace_all");
    span.setAttribute("monitored_repo_count", config.monitored_repos.length);

    // (1) Replace the project_prefix row in reef_settings.
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${params.add(
          REEF_SETTINGS_PROJECT_PREFIX_KEY,
          "settings key",
        )}`,
    );
    await runConfigSql(
      adapter,
      vault,
      // akb manages the auto-injected `updated_at` column itself; we just
      // write the user-defined (key, value) pair.
      (params) =>
        `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${params.add(
          REEF_SETTINGS_PROJECT_PREFIX_KEY,
          "settings key",
        )}, ${params.addJson(config.project_prefix, "project_prefix")})`,
    );

    // (2) Replace the authoring_language row. Unset (null) is the ABSENCE of the
    // row, so consistently DELETE and just INSERT when a language is configured —
    // matching the readConfig contract where a missing row reads as null.
    span.setAttribute(
      "authoring_language",
      config.authoring_language ?? "(unset)",
    );
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${params.add(
          REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
          "settings key",
        )}`,
    );
    if (config.authoring_language != null) {
      await runConfigSql(
        adapter,
        vault,
        (params) =>
          `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${params.add(
            REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
            "settings key",
          )}, ${params.addJson(
            config.authoring_language,
            "authoring_language",
          )})`,
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
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${params.add(
          REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
          "settings key",
        )}`,
    );
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${params.add(
          REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY,
          "settings key",
        )}, ${params.addJson(
          config.stale_hide_completed_days,
          "stale_hide_completed_days",
        )})`,
    );
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${params.add(
          REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
          "settings key",
        )}`,
    );
    await runConfigSql(
      adapter,
      vault,
      (params) =>
        `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${params.add(
          REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY,
          "settings key",
        )}, ${params.addJson(
          config.stale_hide_canceled_days,
          "stale_hide_canceled_days",
        )})`,
    );

    // (4) Replace all monitored_repos rows.
    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(MONITORED_REPOS_TABLE)}`,
    );
    if (config.monitored_repos.length > 0) {
      await runConfigSql(adapter, vault, (params) => {
        const valuesClause = config.monitored_repos
          .map(
            (repo) =>
              `(${params.add(
                repo.github_id,
                "monitored_repo github_id",
              )}, ${params.add(repo.owner, "monitored_repo owner")}, ${params.add(
                repo.name,
                "monitored_repo name",
              )}, ${params.add(
                repo.description,
                "monitored_repo description",
              )})`,
          )
          .join(", ");
        return `INSERT INTO ${tableRef(
          MONITORED_REPOS_TABLE,
        )} (github_id, owner, name, description) VALUES ${valuesClause}`;
      });
    }
  });
}

/**
 * Add initial settings without replacing any values already in the vault.
 * The app installation owns table creation; this routine writes only after
 * that installation is active and never provisions or alters schema.
 */
export async function initializeConfigIfMissing(
  params: WriteConfigParams,
): Promise<void> {
  const { adapter, vault, config } = params;
  return withSpan("akb.initialize_config", { vault }, async (span) => {
    const settings = [
      [REEF_SETTINGS_PROJECT_PREFIX_KEY, config.project_prefix],
      ...(config.authoring_language
        ? [[REEF_SETTINGS_AUTHORING_LANGUAGE_KEY, config.authoring_language]]
        : []),
    ] as const;

    for (const [key, value] of settings) {
      await runConfigSql(adapter, vault, (sqlParams) => {
        const keyParam = sqlParams.add(key, "settings key");
        const valueParam = sqlParams.addJson(value, "initial setting");
        return `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) SELECT ${keyParam}, ${valueParam} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${keyParam}) ON CONFLICT DO NOTHING`;
      });
    }

    for (const repo of config.monitored_repos) {
      await runConfigSql(adapter, vault, (sqlParams) => {
        const githubId = sqlParams.add(
          repo.github_id,
          "monitored_repo github_id",
        );
        const owner = sqlParams.add(repo.owner, "monitored_repo owner");
        const name = sqlParams.add(repo.name, "monitored_repo name");
        const description = sqlParams.add(
          repo.description ?? null,
          "monitored_repo description",
        );
        return `INSERT INTO ${tableRef(MONITORED_REPOS_TABLE)} (github_id, owner, name, description) SELECT ${githubId}, ${owner}, ${name}, ${description} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(MONITORED_REPOS_TABLE)} WHERE github_id = ${githubId}) ON CONFLICT DO NOTHING`;
      });
    }
    span.setAttribute("monitored_repo_count", config.monitored_repos.length);
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
      const sqlParams = new SqlParameterBuilder();
      response = await runSql(
        adapter,
        vault,
        `SELECT key, value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${sqlParams.add(
          REEF_SETTINGS_AUTHORING_LANGUAGE_KEY,
          "settings key",
        )} LIMIT 1`,
        sqlParams.params,
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
