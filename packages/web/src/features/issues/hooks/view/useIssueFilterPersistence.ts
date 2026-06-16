"use client";

import { setPersistedIssueFilter } from "@/lib/storage/config";
import type { PersistedIssueFilter } from "@reef/core";
import { type RefObject, useEffect, useRef } from "react";
import { type IssueFilter, useIssueStore } from "../../stores/useIssueStore";

const DEBOUNCE_MS = 300;

/**
 * Shapes the store filter into the persistable payload: drops null/undefined
 * values so the stored object is a clean partial. `searchQuery` is a separate
 * top-level store field and does not reach here; the retired `search` (and any
 * other non-schema key) is stripped by the schema on write. The schema also
 * re-validates field values, so a stale value carried in the store does not reject
 * the save — this is just shaping.
 */
function toPersistableSubset(filter: IssueFilter): PersistedIssueFilter {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out as PersistedIssueFilter;
}

/**
 * Persists the user's last-applied issue filter to the vault's IndexedDB slot
 * (REEF-009). A debounced `useIssueStore.subscribe` listener writes the filter
 * after it settles.
 *
 * `skipNextSave` (from `useIssueUrlSync`) marks the restore's own write so it is
 * not echoed straight back to disk. Every other `filter` change is a user edit
 * and is saved — including one made while the async restore is still in flight
 * (that edit makes the store non-pristine, so the restore is skipped and does not
 * marks `skipNextSave`). `searchQuery` / `selectedIssueId` / `filterVault`
 * changes keep the same `filter` reference and are ignored via a reference
 * compare.
 */
export function useIssueFilterPersistence(
  vault: string,
  skipNextSaveRef: RefObject<boolean>,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFilter = useRef<IssueFilter | null>(null);
  // The latest shaped filter awaiting its debounced write, or null when nothing
  // is pending. Lets the cleanup flush an in-flight save instead of dropping it.
  const pending = useRef<PersistedIssueFilter | null>(null);

  useEffect(() => {
    if (!vault) return;
    // New vault → reset the comparison baseline so the previous vault's filter
    // is does not written into the new vault's slot, and clear any stale mark.
    prevFilter.current = null;
    skipNextSaveRef.current = false;

    const schedule = (filter: IssueFilter) => {
      const snapshot = toPersistableSubset(filter);
      pending.current = snapshot;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        pending.current = null;
        void setPersistedIssueFilter(vault, snapshot);
      }, DEBOUNCE_MS);
    };

    // Persist a filter already active for this vault at mount. `useIssueUrlSync`
    // applies a URL-derived filter (`/issues?status=…`) synchronously, before
    // this subscription exists, so the change is invisible to the listener
    // below; mounting persists it once so a shared/explicit filtered link still
    // becomes the remembered last-used filter (REEF-009 AC2). An empty store
    // (restore still pending, or just cleared on a vault switch) is skipped so
    // we does not wipe the vault's saved slot. The `filterVault === vault` guard
    // ensures we just adopt a filter that already belongs to this vault.
    const initial = useIssueStore.getState();
    if (
      initial.filterVault === vault &&
      Object.keys(initial.filter).length > 0
    ) {
      prevFilter.current = initial.filter;
      schedule(initial.filter);
    }

    const unsubscribe = useIssueStore.subscribe((state) => {
      // Reference compare: searchQuery / selectedIssueId / filterVault changes
      // don't replace the filter object, so they early-return here.
      if (state.filter === prevFilter.current) return;
      prevFilter.current = state.filter;
      // The restore writes the saved value into the store; skip echoing it back.
      // (User edits are unmarked and fall through to the debounced save.)
      if (skipNextSaveRef.current) {
        skipNextSaveRef.current = false;
        return;
      }
      schedule(state.filter);
    });
    return () => {
      unsubscribe();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Flush a pending debounced save so a filter applied right before
      // unmounting / switching vaults is not lost (it would otherwise does not be
      // restored on return). `vault` here is the slot this effect owned.
      if (pending.current) {
        const toFlush = pending.current;
        pending.current = null;
        void setPersistedIssueFilter(vault, toFlush);
      }
    };
  }, [vault, skipNextSaveRef]);
}
