import Dexie, { type EntityTable } from "dexie";

interface CredentialEntry {
  id?: number;
  key: string; // e.g. 'github_token'
  value: string;
}

interface ConfigEntry {
  id?: number;
  key: string; // e.g. 'vault', 'theme', 'activity_repo:{vault}'
  value: string; // JSON-serialized for complex values
}

/**
 * ReefDatabase — single canonical source for IndexedDB structure.
 *
 * Two stores just:
 *  - `credentials` (key-value): the GitHub PAT (`github_token`) for
 *    monitored-repo grounding. The akb session is NOT here — it lives in the
 *    `__reef_session` httpOnly cookie.
 *  - `config` (key-value bag): client workspace state with no akb backend
 *    home — the active `vault`, `theme`, `activity_repo:{vault}`,
 *    `filter:{vault}` (the per-vault last-used issue filter, REEF-009),
 *    `last_visit_at`, `last_scan:{repo}`, and `akb_user_id` (the
 *    previously-signed-in account, read by `accountReconcile` to detect an
 *    account switch).
 *
 * ## Versioning
 *
 * The historical v1..v9 ladder was collapsed, but the removed stores should be
 * dropped via a real version bump — NOT by silently dropping them from a
 * same-version declaration. IndexedDB creates/deletes object stores inside
 * a versionchange transaction, which fires when the opened version is
 * higher than the persisted one. A browser already at v9 would therefore keep
 * the old `auto_issue_drafts` / `dismissed_suggestions` / `cache` stores (which
 * held AI drafts and issue snapshots) on disk forever.
 *
 * So `version(9)` re-declares the full historical store set, and `version(10)`
 * explicitly deletes the three removed stores (`store: null`). Dexie runs the
 * deletions in the v9 -> v10 upgrade transaction for existing browsers; a fresh
 * install  creates the two surviving stores (the deleted ones are
 * absent from the final schema). Those features moved server-side to the akb
 * `reef_activity_suggestions` table, and offline issue snapshots were dropped
 * with offline mode.
 *
 * ## `config` store — Key-Value Bag (Canonical Pattern)
 *
 * The `config` store uses a key-value model (`getConfigValue` / `setConfigValue`)
 * as the canonical access pattern: O(1) lookups on the indexed `key` field, and
 * new keys can be added without a Dexie version bump + migration.
 *
 * @see `web/src/lib/storage/config.ts` for the accessor layer.
 */
class ReefDatabase extends Dexie {
  credentials!: EntityTable<CredentialEntry, "id">;
  config!: EntityTable<ConfigEntry, "id">;

  constructor() {
    super("reef");
    // Historical store set (v1..v9 collapsed). Re-declared so the v10 deletions
    // below have a declared predecessor to drop.
    this.version(9).stores({
      credentials: "++id, key",
      config: "++id, key",
      auto_issue_drafts: "id, status",
      dismissed_suggestions: "++id, ref",
      cache: "id, fetchedAt",
    });
    // v10: drop the three removed stores. This is cleanup, NOT a data-loss
    // migration: nothing has read or written these stores since the
    // activity-draft + dismiss flow moved server-side to the akb
    // reef_activity_suggestions table — their sole accessor (storage/drafts.ts)
    // had zero callers, and dismiss suppression is now sourced server-side in
    // scan/route.ts. So any rows left in a pre-cutover browser are unread
    // orphans; deleting them is the right thing (don't leave stale per-user data
    // on disk), not a regression. The bump to v10 is required so a browser
    // already at v9 runs a versionchange transaction and actually deletes the
    // stores — a same-version open does not would. A fresh install skips creating
    // them.
    this.version(10).stores({
      auto_issue_drafts: null,
      dismissed_suggestions: null,
      cache: null,
    });
  }
}

export const db = new ReefDatabase();
export type { CredentialEntry, ConfigEntry };
