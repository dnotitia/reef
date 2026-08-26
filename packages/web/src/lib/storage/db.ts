import Dexie, { type EntityTable } from "dexie";

interface ConfigEntry {
  id?: number;
  key: string; // e.g. 'vault', 'theme', 'filter:{vault}'
  value: string; // JSON-serialized for complex values
}

/**
 * ReefDatabase — single canonical source for IndexedDB structure.
 *
 * One live store:
 *  - `config` (key-value bag): client workspace state with no akb backend home
 *    — the active `vault`, `theme`, `filter:{vault}`
 *    (the per-vault last-used issue filter, REEF-009),
 *    `named_filter:{vault}:{id}` (browser-local named issue filter envelopes),
 *    `workspace_favorites:v1` (account-scoped configured workspace names),
 *    `akb_user_id` (the previously-signed-in account,
 *    read by `accountReconcile` to detect an account switch).
 *
 * ## Versioning
 *
 * The historical v1..v9 ladder was collapsed, but removed stores should be
 * dropped via a real version bump — NOT by silently dropping them from a
 * same-version declaration. IndexedDB creates/deletes object stores inside
 * a versionchange transaction, which fires when the opened version is
 * higher than the persisted one. A browser already at v9 would therefore keep
 * the old `auto_issue_drafts` / `dismissed_suggestions` / `cache` stores (which
 * held AI drafts and issue snapshots) on disk forever.
 *
 * So `version(9)` re-declares the full historical store set, `version(10)`
 * explicitly deletes the three removed draft/cache stores, and `version(11)`
 * deletes the `credentials` store after the browser GitHub PAT path moved to
 * deployment-managed GitHub App credentials. Dexie runs these deletions in
 * versionchange transactions for existing browsers; a fresh install creates
 * just the surviving `config` store.
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
    // v10: drop the three obsolete draft/cache stores. They have no live
    // accessors; a fresh install skips creating them.
    this.version(10).stores({
      auto_issue_drafts: null,
      dismissed_suggestions: null,
      cache: null,
    });
    // v11: drop the browser GitHub PAT store. The server-managed GitHub App is
    // now the monitored-repo credential path, so any stale github_token
    // rows should stop being readable and should not remain orphaned in
    // persistent browser storage.
    this.version(11).stores({
      credentials: null,
    });
  }
}

export const db = new ReefDatabase();
export type { ConfigEntry };
