import { type Locale, isLocale } from "@/i18n/locales";
import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import {
  type PersistedIssueFilter,
  PersistedIssueFilterEnvelopeSchema,
  SavedIssueViewSchema,
} from "@reef/core";
import Dexie from "dexie";
import { db } from "./db";

/**
 * Returns `true` when the error represents a Dexie instance whose underlying
 * IndexedDB was closed/deleted by the user (devtools → Clear storage). Callers
 * can then surface a neutral "not configured" state instead of crashing.
 */
function isDexieClosedError(err: unknown): boolean {
  return (
    err instanceof Dexie.DatabaseClosedError ||
    err instanceof Dexie.InvalidStateError ||
    // AbortError is thrown by some Dexie 4.x paths when the backing store is gone
    (err instanceof Error && err.name === "AbortError")
  );
}

/**
 * Reads a string value from the IndexedDB `config` store by key.
 * Returns undefined if no entry is stored or the database has been cleared.
 *
 * This is the escape hatch for arbitrary/unknown keys. For well-known keys,
 * prefer the typed wrapper functions below (e.g., `getActiveVault()`).
 *
 * @see `db.ts` JSDoc for the key-value design decision.
 */
export async function getConfigValue(key: string): Promise<string | undefined> {
  try {
    const entry = await db.config.where("key").equals(key).first();
    return entry?.value;
  } catch (err) {
    if (isDexieClosedError(err)) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Stores (or replaces) a string value in the IndexedDB `config` store under
 * the given key. Silently no-ops when the underlying database is unavailable.
 *
 * This is the escape hatch for arbitrary/unknown keys. For well-known keys,
 * prefer the typed wrapper functions below.
 *
 * @see `db.ts` JSDoc for the key-value design decision.
 */
export async function setConfigValue(
  key: string,
  value: string,
): Promise<void> {
  try {
    const existing = await db.config.where("key").equals(key).first();
    if (existing?.id !== undefined) {
      await db.config.put({ id: existing.id, key, value });
    } else {
      await db.config.add({ key, value });
    }
  } catch (err) {
    if (isDexieClosedError(err)) {
      return;
    }
    throw err;
  }
}

/**
 * Deletes the single config entry stored under `key` (a point delete on the
 * indexed `key` field). No-ops when the database is closed/unavailable.
 */
async function clearConfigKey(key: string): Promise<void> {
  try {
    await db.config.where("key").equals(key).delete();
  } catch (err) {
    if (isDexieClosedError(err)) return;
    throw err;
  }
}

/**
 * Deletes every config entry whose key starts with `prefix` (a range delete on
 * the indexed `key` field, not a full scan). No-ops when the database is
 * closed/unavailable.
 */
export async function clearConfigByPrefix(prefix: string): Promise<void> {
  try {
    await db.config.where("key").startsWith(prefix).delete();
  } catch (err) {
    if (isDexieClosedError(err)) return;
    throw err;
  }
}

// ─── Typed wrappers for canonical config keys ────────────────────────────────
//
// These provide type-safe access to well-known config keys with appropriate
// default fallbacks. They use `getConfigValue` / `setConfigValue` internally
// so the key-value pattern remains the single implementation path.

/**
 * Returns the active akb vault name (e.g., "reef-acme") — the workspace the
 * user is currently viewing. Empty string if not yet configured.
 */
export async function getActiveVault(): Promise<string> {
  return (await getConfigValue("vault")) ?? "";
}

/**
 * Matches a GitHub "owner/repo" full_name per GitHub's allowed character set:
 *   - owner: letters, digits, hyphens, underscores (no leading hyphen); max 39 chars.
 *     Underscores appear in Enterprise Managed Users (EMU) login names
 *     (`<shortcode>_<enterprise>`), so they should be allowed here.
 *   - repo: letters, digits, hyphens, underscores, dots; max 100 chars
 * We keep the regex intentionally tight enough to reject invalid inputs but
 * permissive enough to avoid rejecting valid edge cases (e.g. trailing dots
 * are rejected in practice, but we don't enforce that here — GitHub's API
 * will reject such inputs at the point of use).
 */
const REPO_FULL_NAME_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/**
 * Validates a single "owner/repo" string. Throws a TypeError when the input
 * is not a string or does not match the expected full_name format. An empty
 * string is intentionally rejected here — callers that need to clear a repo
 * should use the dedicated clear path (empty string is just valid for the
 * management repo and is handled explicitly in its setter).
 */
function assertValidRepoFullName(repo: string, context: string): void {
  if (typeof repo !== "string") {
    throw new TypeError(`${context}: expected string, got ${typeof repo}`);
  }
  if (!REPO_FULL_NAME_RE.test(repo)) {
    throw new TypeError(
      `${context}: "${repo}" is not a valid "owner/repo" full_name`,
    );
  }
}

/**
 * Per-vault "which monitored repo am I scanning right now" pointer. The
 * Activity tab's auto-detection scan + manual refresh both operate on a
 * single GitHub repo, but a workspace can monitor several. We persist the
 * choice keyed by vault so switching workspaces doesn't drag the previous
 * vault's pick along.
 *
 * The Activity hook auto-falls back to `monitored_repos[0]` when no pointer
 * is saved, so first-run just works without the user touching the picker.
 */
function activityRepoStorageKey(vault: string): string {
  return `activity_repo:${vault}`;
}

/**
 * Returns the user's saved scan target for the given vault, or undefined when
 * no choice has been persisted yet. Empty string is a valid stored value
 * (older clears) and is returned as-is — callers treat it the same as
 * undefined.
 */
export async function getActivityRepo(
  vault: string,
): Promise<string | undefined> {
  if (!vault) return undefined;
  return getConfigValue(activityRepoStorageKey(vault));
}

/**
 * Persists the chosen scan target for a vault. Pass an empty string to clear
 * the pointer (so the consumer falls back to `monitored_repos[0]`). Throws
 * TypeError on malformed `owner/name` input.
 */
export async function setActivityRepo(
  vault: string,
  repo: string,
): Promise<void> {
  if (typeof vault !== "string" || !vault) {
    throw new TypeError("setActivityRepo: vault is required");
  }
  if (typeof repo !== "string") {
    throw new TypeError(`setActivityRepo: expected string, got ${typeof repo}`);
  }
  if (repo !== "") {
    assertValidRepoFullName(repo, "setActivityRepo");
  }
  return setConfigValue(activityRepoStorageKey(vault), repo);
}

// ─── Per-vault issue filter persistence (REEF-009) ───────────────────────────
//
// The user's last-applied issue filter + sort, persisted per vault so a reload
// or revisit restores their working scope. Stored as a versioned JSON envelope
// under `filter:{vault}`, mirroring the `activity_repo:{vault}` per-vault key
// pattern. Browser-local preference just — does not server-side (stateless BFF).
// `searchQuery` and view mode are intentionally NOT persisted (see the filter
// store + the persisted schema in core).

/** The IndexedDB `config` key holding a vault's persisted issue filter. */
function issueFilterStorageKey(vault: string): string {
  return `filter:${vault}`;
}

/**
 * Returns the `vault`'s last-saved issue filter, or `{}` when nothing is stored,
 * the JSON is corrupt, or the persisted envelope version no longer matches (hard
 * discard → safe defaults, REEF-009 AC5). Individual invalid fields are dropped
 * by the schema's per-field `.catch`; the surviving `undefined` keys are then
 * stripped so the result is a clean partial filter ready to merge into the
 * store.
 *
 * `vault` is the akb slug (e.g. "reef-acme"). `getConfigValue` swallows
 * Dexie-closed errors and returns undefined, so a cleared/closed database
 * degrades to `{}` rather than throwing.
 */
export async function getPersistedIssueFilter(
  vault: string,
): Promise<PersistedIssueFilter> {
  if (!vault) return {};
  const raw = await getConfigValue(issueFilterStorageKey(vault));
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = PersistedIssueFilterEnvelopeSchema.safeParse(parsed);
  if (!result.success) return {};
  const cleaned: PersistedIssueFilter = {};
  for (const [key, value] of Object.entries(result.data.filter)) {
    if (value !== undefined) {
      (cleaned as Record<string, unknown>)[key] = value;
    }
  }
  return cleaned;
}

/**
 * Persists the `vault`'s last-applied issue filter, wrapped in the versioned
 * envelope. Throws TypeError when `vault` is missing. The schema does not throws on
 * bad field *content* (each field `.catch`es to undefined, dropped by
 * JSON.stringify), so a stale value carried in the store does not reject the
 * write — the envelope shape is enforced.
 */
export async function setPersistedIssueFilter(
  vault: string,
  filter: PersistedIssueFilter,
): Promise<void> {
  if (typeof vault !== "string" || !vault) {
    throw new TypeError("setPersistedIssueFilter: vault is required");
  }
  const envelope = PersistedIssueFilterEnvelopeSchema.parse({
    version: 1,
    filter,
  });
  return setConfigValue(issueFilterStorageKey(vault), JSON.stringify(envelope));
}

/**
 * Clears a single vault's persisted filter slot (writes the empty-string
 * sentinel, read back as `{}`). Throws TypeError when `vault` is missing.
 */
export async function clearPersistedIssueFilter(vault: string): Promise<void> {
  if (typeof vault !== "string" || !vault) {
    throw new TypeError("clearPersistedIssueFilter: vault is required");
  }
  return setConfigValue(issueFilterStorageKey(vault), "");
}

/**
 * Deletes every persisted issue filter (`filter:*`) across all vaults. Used by
 * account-switch reconciliation so a different account on the same browser does
 * not inherit the previous account's saved filters. The indexed `key` field
 * makes this a range delete, not a full scan. No-ops when the database is
 * closed/unavailable.
 */
export async function clearAllIssueFilters(): Promise<void> {
  return clearConfigByPrefix("filter:");
}

function defaultIssueViewStorageKey(vault: string): string {
  return `default_issue_view:${vault}`;
}

export async function getDefaultIssueViewId(
  vault: string,
): Promise<string | undefined> {
  if (!vault) return undefined;
  return getConfigValue(defaultIssueViewStorageKey(vault));
}

export async function setDefaultIssueViewId(
  vault: string,
  id: string,
): Promise<void> {
  if (!vault) throw new TypeError("setDefaultIssueViewId: vault is required");
  if (!id) return clearDefaultIssueViewId(vault);
  return setConfigValue(defaultIssueViewStorageKey(vault), id);
}

export async function clearDefaultIssueViewId(vault: string): Promise<void> {
  if (!vault) return;
  return clearConfigKey(defaultIssueViewStorageKey(vault));
}

export async function clearAllDefaultIssueViews(): Promise<void> {
  return clearConfigByPrefix("default_issue_view:");
}

interface FavoriteIssueViewsEnvelope {
  version: 1;
  ids: string[];
}

function favoriteIssueViewsStorageKey(vault: string): string {
  return `favorite_issue_views:${vault}`;
}

function normalizeFavoriteIssueViewIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const valid = ids.flatMap((id) => {
    const parsed = SavedIssueViewSchema.shape.id.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
  return [...new Set(valid)];
}

export async function getFavoriteIssueViewIds(
  vault: string,
): Promise<string[]> {
  if (!vault) return [];
  const raw = await getConfigValue(favoriteIssueViewsStorageKey(vault));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("ids" in parsed)
  ) {
    return [];
  }
  return normalizeFavoriteIssueViewIds(parsed.ids);
}

export async function setFavoriteIssueViewIds(
  vault: string,
  ids: readonly string[],
): Promise<void> {
  if (!vault) throw new TypeError("setFavoriteIssueViewIds: vault is required");
  const envelope: FavoriteIssueViewsEnvelope = {
    version: 1,
    ids: normalizeFavoriteIssueViewIds(ids),
  };
  return setConfigValue(
    favoriteIssueViewsStorageKey(vault),
    JSON.stringify(envelope),
  );
}

export async function clearFavoriteIssueViewIds(vault: string): Promise<void> {
  if (!vault) return;
  return clearConfigKey(favoriteIssueViewsStorageKey(vault));
}

export async function clearAllFavoriteIssueViews(): Promise<void> {
  return clearConfigByPrefix("favorite_issue_views:");
}

/**
 * Deletes every persisted scan-target pointer (`activity_repo:*`) across all
 * vaults. Account-scoped (a different account sees different vaults), so the
 * sign-out / account-switch wipe should clear it or the next user inherits the
 * previous user's selected scan repo.
 */
export async function clearAllActivityRepos(): Promise<void> {
  return clearConfigByPrefix("activity_repo:");
}

/**
 * Clears the activity-inbox read marker (`last_visit_at`). Per-user state, so
 * leaving it after sign-out would skew the next user's unread count.
 */
export async function clearLastVisitAt(): Promise<void> {
  return clearConfigKey("last_visit_at");
}

/**
 * Stores (or replaces) the active akb vault name in IndexedDB. Pass an
 * empty string to clear it. Throws TypeError on malformed input.
 */
export async function setActiveVault(vault: string): Promise<void> {
  if (typeof vault !== "string") {
    throw new TypeError(`setActiveVault: expected string, got ${typeof vault}`);
  }
  if (vault !== "" && !VAULT_NAME_RE.test(vault)) {
    throw new TypeError(
      `setActiveVault: "${vault}" is not a valid akb vault name`,
    );
  }
  return setConfigValue("vault", vault);
}

// ─── AKB account identity ────────────────────────────────────────────────────
//
// The id of the AKB user whose session last signed in on this browser. AKB is
// the auth boundary post-pivot; recording it lets the login path detect an
// account switch and wipe the previous account's workspace-scoped state (see
// `lib/akb/accountReconcile.ts`). Not a secret — it is the signed-in user's
// own id, mirrored from the /api/auth/akb/login response.

/**
 * Returns the last signed-in AKB user id, or undefined when no AKB session
 * has been established on this browser yet.
 */
export async function getAkbUserId(): Promise<string | undefined> {
  return getConfigValue("akb_user_id");
}

/**
 * Records the AKB user id of the current session. Throws TypeError on empty
 * or non-string input.
 */
export async function setAkbUserId(userId: string): Promise<void> {
  if (typeof userId !== "string" || !userId) {
    throw new TypeError("setAkbUserId: userId is required");
  }
  return setConfigValue("akb_user_id", userId);
}

/**
 * Removes the recorded akb user id. Used on workspace sign-out so the next
 * login is treated as a fresh account (the account-switch wipe re-runs,
 * harmlessly, on re-login). Mirrors `clearAllIssueFilters`' delete-by-key
 * shape and no-ops when the underlying database is unavailable.
 */
export async function clearAkbUserId(): Promise<void> {
  return clearConfigKey("akb_user_id");
}

/** UI theme preference. "system" follows the OS color scheme. */
export type ThemePreference = "light" | "dark" | "system";

function isThemePreference(v: string | undefined): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * Returns the user's stored theme preference. Defaults to "system" (follow OS)
 * when nothing is persisted yet OR when the persisted value is not one of the
 * three legal states — defensive against a manually edited config row.
 */
export async function getTheme(): Promise<ThemePreference> {
  const val = await getConfigValue("theme");
  return isThemePreference(val) ? val : "system";
}

/**
 * Persists the user's theme preference to IndexedDB.
 *
 * Pairs with the localStorage mirror written in `applyTheme` (UI layer) so
 * the no-flash boot script can read the value synchronously before paint
 * without awaiting Dexie. IndexedDB remains the canonical source.
 */
export async function setTheme(theme: ThemePreference): Promise<void> {
  return setConfigValue("theme", theme);
}

// ─── UI locale preference (REEF-291) ─────────────────────────────────────────
//
// The per-viewer UI language. IndexedDB is the canonical store (ADR-0001),
// mirrored to a non-httpOnly `NEXT_LOCALE` cookie that the server reads on the
// first request (Dexie isn't readable during SSR). Unlike `theme`, there is no
// default-on value: an absent entry means "no explicit choice yet", so the
// server detection chain (cookie → Accept-Language → en) governs instead.

/**
 * Returns the user's stored UI locale, or `undefined` when none has been chosen
 * (or the persisted value is not a supported locale — defensive against a
 * hand-edited config row). `undefined` defers to server-side detection.
 */
export async function getLocale(): Promise<Locale | undefined> {
  const val = await getConfigValue("locale");
  return isLocale(val) ? val : undefined;
}

/**
 * Persists the user's UI locale to IndexedDB.
 *
 * Pairs with the `NEXT_LOCALE` cookie written in `applyLocale` (UI layer) so the
 * server can resolve the locale on the next request before paint. IndexedDB
 * remains the canonical source and restores the choice if the cookie is cleared
 * or expires.
 */
export async function setLocale(locale: Locale): Promise<void> {
  return setConfigValue("locale", locale);
}
