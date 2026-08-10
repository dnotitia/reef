"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { buildOpenIssueHref } from "../../lib/issueHref";
import { useIssueNavStack } from "../../stores/useIssueNavStack";

interface UseIssueSheetDismissArgs {
  /** Issue id currently shown in the sheet (the live detail route param). */
  issueId: string;
  /**
   * Exit the sheet to its entry view — the list/board the user came from. The
   * first sheet in a detail session owns this callback; a relation drill can
   * remount the sheet through the intercepting route, but it must not replace
   * the original Close destination.
   */
  onExit: () => void;
}

/**
 * Back / Close / Esc semantics for the issue detail sheet, driven by the
 * in-memory drill trail rather than the browser history (REEF-270).
 *
 *  - `backTo` — the issue a single Back returns to, or null when not drilled in.
 *  - `goBack()` — pop one hop and `replace` to the previous issue.
 *  - `exit()` — clear the whole trail and leave to the entry view (Close /
 *    outside click). With flat history this returns to the list in one step.
 *  - `dismissViaEsc()` — Back while drilled in, else Close (AC3).
 *
 * The trail is reconciled to the live route id so an open the store didn't drive
 * (fresh open from the list, ⌘K palette, a deep link) resets to depth 0.
 */
export function useIssueSheetDismiss({
  issueId,
  onExit,
}: UseIssueSheetDismissArgs) {
  const router = useRouter();
  // `useSearchParams()` needs no Suspense boundary here: every (dashboard) route
  // — `/issues/[id]` included — is server-rendered on demand (dynamic `ƒ` in the
  // build output), not statically prerendered, so it is unable to trigger the
  // static-prerender CSR bailout. The sibling `useOpenIssue` reads the query the
  // same way in this route family.
  const searchParams = useSearchParams();
  const { vault } = useActiveVault();
  const trail = useIssueNavStack((state) => state.trail);
  const currentId = useIssueNavStack((state) => state.currentId);
  const back = useIssueNavStack((state) => state.back);
  const reconcile = useIssueNavStack((state) => state.reconcile);
  const registerExitOwner = useIssueNavStack(
    (state) => state.registerExitOwner,
  );
  const clear = useIssueNavStack((state) => state.clear);

  // Reconcile the trail with the route id the sheet mounted on. The intercepted
  // sheet remounts on every hop AND every fresh open, so this runs once per
  // arrival; it's idempotent (safe under StrictMode's double-invoked effects).
  // A drill/back set `currentId` to this id, so its arrival keeps the trail; any
  // other arrival resets to depth 0. The stale-trail case — a sheet left via
  // browser Back without Close — is cleared by the `@modal` default slot when
  // the list comes back, so `currentId` is no longer matching by the time the
  // same id is reopened.
  useEffect(() => {
    reconcile(issueId);
  }, [issueId, reconcile]);

  // Keep the entry callback in a separate effect so a re-render of the outgoing
  // sheet during a drill cannot reconcile its old route id back over the target
  // that `drill()` just recorded. The first callback still wins; remounted
  // relation routes are ignored by the store.
  useEffect(() => {
    registerExitOwner(onExit);
  }, [onExit, registerExitOwner]);

  // Solely trust the trail when it actually describes the on-screen issue, so the
  // outgoing sheet does not flash a Back to itself the instant a hop moves the
  // store's `currentId` before its `router.replace` swaps the route in.
  const backTo =
    currentId === issueId && trail.length > 0
      ? (trail[trail.length - 1] ?? null)
      : null;

  const goBack = useCallback(() => {
    const previous = back();
    if (previous) {
      router.replace(buildOpenIssueHref(vault, previous, searchParams));
    }
  }, [back, router, searchParams, vault]);

  const exit = useCallback(() => {
    const sessionExit = useIssueNavStack.getState().exitOwner ?? onExit;
    clear();
    sessionExit();
  }, [clear, onExit]);

  const dismissViaEsc = useCallback(() => {
    if (backTo) {
      goBack();
    } else {
      exit();
    }
  }, [backTo, goBack, exit]);

  return { backTo, goBack, exit, dismissViaEsc };
}
