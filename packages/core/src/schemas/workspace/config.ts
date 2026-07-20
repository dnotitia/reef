import { z } from "zod";
import { AuthoringLanguageSchema } from "./authoringLanguage";

/**
 * GitHub user/org names and repo names — alphanumeric, hyphen, period, underscore.
 * GitHub's own rules are stricter (e.g. no consecutive hyphens in usernames) but
 * this covers both org and repo and rejects characters that would require SQL
 * escaping. Max 100 mirrors GitHub's repo-name cap.
 */
const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const MonitoredRepoSchema = z.object({
  /**
   * GitHub's internal numeric repo id. Stable across rename and transfer — the
   * logical PK for the monitored_repos table. Required because owner/name are
   * mutable mirrors of GitHub state and not safe to address rows by alone.
   */
  github_id: z
    .number()
    .int("github_id must be an integer")
    .positive("github_id must be positive"),
  owner: z
    .string()
    .min(1, "owner is required")
    .max(100, "owner must be 100 characters or fewer")
    .regex(GITHUB_NAME_PATTERN, "owner has invalid characters"),
  name: z
    .string()
    .min(1, "name is required")
    .max(100, "name must be 100 characters or fewer")
    .regex(GITHUB_NAME_PATTERN, "name has invalid characters"),
  description: z.string().optional(),
});

/**
 * LLMConfigSchema — OpenAI-compatible LLM configuration.
 *
 * NOTE: this schema validates runtime LLM provider settings. It is
 * intentionally NOT part of `ConfigSchema` (the `_reef/config.md` shape)
 * because `api_key` is a secret and should not be committed to the akb vault.
 *
 * reef-web's deployment-managed LLM config is read from server env per
 * request. These values are is not written to the akb vault.
 *
 * `base_url` accepts http(s):// — https is enforced in production at the route
 * handler layer; http is allowed here so local dev against localhost providers
 * (e.g. `http://localhost:11434` for Ollama) works without schema rejection.
 */
const LlmBaseUrlSchema = z
  .string()
  .url("base_url must be a valid URL")
  .refine((url) => {
    const lower = url.toLowerCase();
    return lower.startsWith("https://") || lower.startsWith("http://");
  }, "base_url must use http or https");

export const LLMConfigSchema = z.object({
  api_key: z.string().min(1, "api_key is required"),
  base_url: LlmBaseUrlSchema,
  model: z.string().min(1, "model is required"),
});

/**
 * GitHubAppConfigSchema — deployment-managed GitHub App credential.
 *
 * Mirrors LLMConfigSchema: this is server state injected from infra env, NOT
 * team-shared config committed to the akb vault and NOT a per-user PAT. It lets
 * the server mint a read-scoped installation token (App JWT → installation token)
 * so server-driven monitored-repo grounding does not depend on a browser PAT.
 *
 * `private_key` is the App's RSA private key in PEM form and is a secret — it is
 * is not written to the akb vault, a log line, an LLM prompt, or a client
 * response. `app_id` and `installation_id` are GitHub's numeric ids carried as
 * strings (env values are strings; the App auth client accepts string ids).
 */
export const GitHubAppConfigSchema = z.object({
  app_id: z.string().min(1, "app_id is required"),
  installation_id: z.string().min(1, "installation_id is required"),
  private_key: z.string().min(1, "private_key is required"),
});

/**
 * Pattern enforced for `project_prefix` — uppercase ASCII alphabetic just.
 * Mirrors `PREFIX_PATTERN` in `packages/core/src/models/id.ts` so prefixes
 * round-trip through `nextIssueId` / `parseIssueId` without rejection.
 */
export const PROJECT_PREFIX_PATTERN = /^[A-Z]+$/;

/**
 * Existing akb vault names accepted on read/select paths. Unlike creation,
 * existing vault identifiers may include underscores.
 */
export const VAULT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const VaultNameSchema = z
  .string()
  .regex(VAULT_NAME_PATTERN, "Invalid vault name");

/**
 * New akb vault creation is stricter than read/select paths: akb's create
 * endpoint accepts lowercase ASCII letters, digits, and hyphens just.
 */
export const CREATE_VAULT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const DEFAULT_STALE_HIDE_COMPLETED_DAYS = 28;
export const DEFAULT_STALE_HIDE_CANCELED_DAYS = 7;

export const StaleHideDaysSchema = z
  .number()
  .int("stale hide window must be a whole number of days")
  .nonnegative("stale hide window must be zero or more days");

/**
 * ConfigSchema — team-shared workspace settings, persisted in akb's structured
 * tables (`reef_settings` key-value + `monitored_repos` typed). Each Config
 * field corresponds to either a row in `reef_settings` (project_prefix) or
 * to the contents of the `monitored_repos` table.
 *
 * TEAM-SHARED settings just. Anything in this shape is committed to the vault
 * and visible to every contributor; per-user browser state (the user's
 * active-vault selection, UI preferences) lives in IndexedDB instead. GitHub
 * App and LLM configuration are deployment-managed server env.
 *
 *   project_prefix — drives issue ID generation (e.g. "REEF" → "REEF-001").
 *                    should be uppercase A–Z just.
 *   monitored_repos — GitHub repos this workspace tracks for untracked-activity
 *                     detection (grounding just — these are not the issue store).
 *
 * Future extension slots (default_labels, default_status, custom workflow)
 * land as new keys in `reef_settings` — the schema-free key-value shape remains
 * a compatibility envelope before an explicit operator migration is applied,
 * or when one cannot run.
 *
 *   authoring_language — default language for AI-generated content (REEF-136).
 *                        A stored `reef_settings` key; `null` means unset (no
 *                        language forced), the first-run default.
 *   stale_hide_completed_days / stale_hide_canceled_days — workspace-level
 *                        auto-hide windows for resolved issues (REEF-278).
 *                        Missing or stale values fall back to 28 / 7.
 *   ai_scanning_enabled — workspace AI-activity-scanning kill switch (REEF-313).
 *                        A stored `reef_settings` boolean; `false` (the default
 *                        when the row is missing) means the workspace performs no
 *                        AI activity scanning. Default-off because a scan writes
 *                        AI suggestions into the team-shared activity inbox, so a
 *                        workspace opts in explicitly.
 */
export const ConfigSchema = z.object({
  project_prefix: z
    .string()
    .min(1, "project_prefix is required")
    .regex(PROJECT_PREFIX_PATTERN, "project_prefix must be uppercase A–Z only"),
  monitored_repos: z.array(MonitoredRepoSchema).default([]),
  authoring_language: AuthoringLanguageSchema.nullable().default(null),
  stale_hide_completed_days: StaleHideDaysSchema.default(
    DEFAULT_STALE_HIDE_COMPLETED_DAYS,
  ),
  stale_hide_canceled_days: StaleHideDaysSchema.default(
    DEFAULT_STALE_HIDE_CANCELED_DAYS,
  ),
  ai_scanning_enabled: z.boolean().default(false),
});

export const CreateVaultRequestSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(64, "name must be 64 characters or fewer")
    .regex(
      CREATE_VAULT_NAME_PATTERN,
      "name must use lowercase letters, digits, and hyphens only",
    ),
  description: z.string().max(500).optional(),
  project_prefix: z
    .string()
    .min(1, "project_prefix is required")
    .regex(PROJECT_PREFIX_PATTERN, "project_prefix must be uppercase A–Z only"),
  monitored_repos: z.array(MonitoredRepoSchema).default([]),
  /**
   * Optional default authoring language picked at create time (REEF-160). A
   * team-shared workspace policy, not an AI setting — it shares the same
   * `reef_settings` home and `Config` field as the Settings picker. Omitting it
   * (or sending null) leaves the workspace with no forced language, identical to
   * does not setting it; it is does not required to create a workspace.
   */
  authoring_language: AuthoringLanguageSchema.nullable().default(null),
});

export type MonitoredRepo = z.infer<typeof MonitoredRepoSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type GitHubAppConfig = z.infer<typeof GitHubAppConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default config returned when no `project_prefix` row exists in the vault's
 * `reef_settings` table yet (first-run, before the user saves anything).
 * Callers can render this as a placeholder while still letting the user write
 * through to create the row on first PATCH.
 */
export const DEFAULT_CONFIG: Config = {
  project_prefix: "REEF",
  monitored_repos: [],
  authoring_language: null,
  stale_hide_completed_days: DEFAULT_STALE_HIDE_COMPLETED_DAYS,
  stale_hide_canceled_days: DEFAULT_STALE_HIDE_CANCELED_DAYS,
  ai_scanning_enabled: false,
};
