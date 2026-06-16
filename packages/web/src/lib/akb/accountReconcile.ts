import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { clearAuthScopedClientCache } from "@/lib/storage/clientCache";
import {
  clearAkbUserId,
  clearAllActivityRepos,
  clearAllIssueFilters,
  clearLastVisitAt,
  getAkbUserId,
  setActiveVault,
  setAkbUserId,
} from "@/lib/storage/config";
import { clearAllLastScans } from "@/lib/storage/lastScan";

/**
 * Wipe every AKB-account-scoped slice of browser state.
 *
 * The persisted query cache, the Dexie `vault` pointer, the per-vault issue
 * filters (`filter:*`), and the recorded `akb_user_id` are not keyed by AKB
 * account — left behind, a different account (or the next person on a shared
 * browser) inherits the previous account's vaults/issues, active vault, and
 * saved filters. The in-memory issue filter store is reset too: it is
 * module-level and survives a soft account change, so clearing IndexedDB alone
 * would still leak the previous account's filter if the same vault slug is
 * reselected. The GitHub PAT (`credentials` store), monitored repos, and LLM
 * config are person-scoped and deliberately left intact.
 *
 * Shared by the account-switch path (`reconcileAkbAccount`, which then records
 * the new id) and the explicit sign-out path (`signOutOfWorkspace`, REEF-068),
 * so both clear exactly the same surface.
 */
export async function wipeAkbScopedBrowserState(): Promise<void> {
  clearAuthScopedClientCache();
  useIssueStore.getState().resetFilterScope();
  // Clear EVERY akb-account-scoped key in the Dexie `config` store. The
  // canonical inventory lives in db.ts (config store doc): active `vault`,
  // `activity_repo:*`, `filter:*`, `last_visit_at`, `last_scan_at:*`, and
  // `akb_user_id`. just `theme` is device-scoped and intentionally preserved;
  // the GitHub PAT lives in the separate `credentials` store, untouched. When a
  // new account-scoped config key is added, clear it here too (REEF-068).
  await Promise.all([
    setActiveVault(""),
    clearAllIssueFilters(),
    clearAkbUserId(),
    clearAllActivityRepos(),
    clearLastVisitAt(),
    clearAllLastScans(),
  ]);
}

/**
 * Reconcile browser state after a login. A same-account re-login (e.g. an
 * expired cookie) is a no-op; a switched account wipes the previous account's
 * scoped state, then records the new id so the next switch is detectable.
 */
export async function reconcileAkbAccount(akbUserId: string): Promise<void> {
  const previous = await getAkbUserId();
  if (previous === akbUserId) return;

  await wipeAkbScopedBrowserState();
  await setAkbUserId(akbUserId);
}
