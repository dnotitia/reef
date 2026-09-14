import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { clearAuthScopedClientCache } from "@/lib/storage/clientCache";
import {
  clearAkbUserId,
  clearAllIssueFilters,
  getAkbUserId,
  setActiveVault,
  setAkbUserId,
} from "@/lib/storage/config";
import { clearAllMyViews } from "@/lib/storage/myView";
import { clearWorkspaceFavorites } from "@/lib/storage/workspaceFavorites";

/**
 * Clear authenticated product data without deleting browser-local account
 * preferences. Passive session expiry uses this narrower boundary so stale
 * protected data cannot survive while the next same-account login can still
 * restore the user's workspace context.
 */
export function clearAuthenticatedBrowserState(): void {
  clearAuthScopedClientCache();
}

/** Clear preferences that must not cross an account boundary. */
export async function clearAccountPreferenceState(): Promise<void> {
  useIssueStore.getState().resetFilterScope();
  // Clear EVERY account-scoped key in the Dexie `config` store. The canonical
  // inventory lives in db.ts: active `vault`, `filter:*`, `my_view:*`,
  // `workspace_favorites`, and `akb_user_id`. `theme` is device-scoped and
  // intentionally preserved.
  await Promise.all([
    setActiveVault(""),
    clearAllIssueFilters(),
    clearAllMyViews(),
    clearWorkspaceFavorites(),
    clearAkbUserId(),
  ]);
}

/**
 * Wipe every AKB-account-scoped slice of browser state.
 *
 * The persisted query cache, the Dexie `vault` pointer, the per-vault issue
 * filters (`filter:*`), and the recorded `akb_user_id` are not keyed by AKB
 * account — left behind, a different account (or the next person on a shared
 * browser) inherits the previous account's vaults/issues, active vault, and
 * saved filters and My Views. The in-memory issue filter store is reset too: it is
 * module-level and survives a soft account change, so clearing IndexedDB alone
 * would still leak the previous account's filter if the same vault slug is
 * reselected. Monitored repos and LLM config are deployment/workspace state and
 * deliberately left intact.
 *
 * Shared by the account-switch path (`reconcileAkbAccount`, which then records
 * the new id) and the explicit sign-out path (`signOutOfWorkspace`, REEF-068),
 * so both clear exactly the same surface.
 */
export async function wipeAkbScopedBrowserState(): Promise<void> {
  clearAuthenticatedBrowserState();
  await clearAccountPreferenceState();
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
