// ─── akb collection + table identity ──────────────────────────────────────────
//
// Bare constants shared across the akb adapter modules: the collection names
// reef writes documents into, and the structured-data table names it writes SQL
// against. Pure data — no imports — so every other adapter module can depend on
// it without a cycle.

export const ISSUES_COLLECTION = "issues";
export const ACTIVITY_INBOX_COLLECTION = "_reef/activity-inbox";

/**
 * Names of the structured-data tables reef writes into an akb vault. Tables
 * live at vault root (no collection) and are managed via akb's HTTP
 * `/api/v1/tables/{vault}` endpoints.
 *
 *   reef_settings — single-row-per-key team-shared settings (project_prefix
 *                   today, future flags later). Schema-free `value json`
 *                   sidesteps the fact that akb does not expose ALTER TABLE
 *                   via HTTP.
 *   monitored_repos — typed rows for GitHub repos this workspace tracks. PK
 *                     is the GitHub numeric `github_id` (rename/transfer-safe).
 *   reef_issues — one row per reef issue, the queryable read projection of the
 *                 issue's akb document. `document_uri` links back to the doc
 *                 (the canonical source for title/labels/relationships/body).
 *                 Holds the reef-extension fields that have no akb-native home
 *                 (status/priority/assigned_to/...) plus a denormalized copy of
 *                 the fields the board needs so listing is a single SELECT.
 *   reef_templates — one row per issue template, addressed by its `name` stem.
 *                 Self-contained (no backing document): the template body is a
 *                 plain `text` column, so list/read/write are single SQL
 *                 statements. Mirrors the config/settings table model rather
 *                 than the issue's two-store split — a template's body is
 *                 boilerplate "material", not a searchable akb document.
 *   reef_comments — flat issue comment rows keyed by `reef_id`; comment author
 *                 and edit semantics live in `meta` so the create-time schema
 *                 stays small while akb lacks HTTP ALTER support.
 *   reef_attachments — issue-scoped AKB file metadata. File bytes stay in AKB
 *                 file storage; this table holds the queryable issue link and
 *                 Jira import provenance.
 *   reef_activity — immutable issue event rows keyed by `(reef_id, event_key)`;
 *                 event-specific details live in `payload`, and actor/source
 *                 audit semantics live in `meta`.
 */
export const REEF_SETTINGS_TABLE = "reef_settings";
export const MONITORED_REPOS_TABLE = "monitored_repos";
export const REEF_ISSUES_TABLE = "reef_issues";
export const REEF_TEMPLATES_TABLE = "reef_templates";
export const REEF_ACTIVITY_SUGGESTIONS_TABLE = "reef_activity_suggestions";
export const REEF_COMMENTS_TABLE = "reef_comments";
export const REEF_ATTACHMENTS_TABLE = "reef_attachments";
export const REEF_ACTIVITY_TABLE = "reef_activity";
export const REEF_SPRINTS_TABLE = "reef_sprints";
export const REEF_MILESTONES_TABLE = "reef_milestones";
export const REEF_RELEASES_TABLE = "reef_releases";
export const REEF_SETTINGS_PROJECT_PREFIX_KEY = "project_prefix";
export const REEF_SETTINGS_SCHEMA_VERSION_KEY = "schema_version";
/**
 * `reef_settings` key holding the installed vault-skill version stamp. Value is
 * a JSON object `{ version, synced_at }` written by `installReefVaultSkill`
 * after the skill documents land — the queryable signal for "is this vault's
 * agent playbook current with the running release". A vault onboarded before
 * this key existed simply has no row, which reads as `installed_version: null`
 * (older) and the first re-apply backfills it.
 */
export const REEF_SETTINGS_VAULT_SKILL_KEY = "vault_skill";
/**
 * `reef_settings` key holding the workspace default authoring language (REEF-136).
 * Value is a JSON string language code (e.g. `"ko"`). A vault with no row has no
 * authoring-language default — AI generation falls back to its prior behavior.
 */
export const REEF_SETTINGS_AUTHORING_LANGUAGE_KEY = "authoring_language";
export const REEF_SETTINGS_STALE_HIDE_COMPLETED_DAYS_KEY =
  "stale_hide_completed_days";
export const REEF_SETTINGS_STALE_HIDE_CANCELED_DAYS_KEY =
  "stale_hide_canceled_days";
/**
 * `reef_settings` key holding the workspace AI-activity-scanning kill switch
 * (REEF-313). Value is a JSON boolean. A vault with no row reads as `false`
 * (the first-run default) — scanning stays off until a workspace admin turns it
 * on, because a scan writes AI suggestions into the team-shared activity inbox.
 */
export const REEF_SETTINGS_AI_SCANNING_ENABLED_KEY = "ai_scanning_enabled";

/**
 * Closed set of every table name reef writes SQL against. Used as the input
 * type of `tableRef` so the compiler forces a new table constant to be
 * registered here before it can be referenced in a SQL statement — that
 * guards against accidentally bypassing the lowercase / non-keyword
 * convention that `tableRef`'s bare-identifier contract relies on.
 */
export const REEF_TABLE_NAMES = [
  REEF_SETTINGS_TABLE,
  MONITORED_REPOS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_TEMPLATES_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ATTACHMENTS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
] as const;
export type ReefTableName = (typeof REEF_TABLE_NAMES)[number];
