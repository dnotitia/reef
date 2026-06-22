"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { buildOpenIssueHref } from "../../lib/issueHref";
import { useIssueNavStack } from "../../stores/useIssueNavStack";

interface UseIssueSheetDismissArgs {
  /** Issue id currently shown in the sheet (the live detail route param). */
  issueId: string;
  /**
   * Exit the sheet to its entry view — the list/board the user came from. The
   * soft-nav intercepting route passes `router.back()` (one step, since drill
   * hops are flat `replace`s); the deep-link base route passes
   * `router.push("/issues")`.
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
  const searchParams = useSearchParams();
  const trail = useIssueNavStack((state) => state.trail);
  const currentId = useIssueNavStack((state) => state.currentId);
  const back = useIssueNavStack((state) => state.back);
  const reconcile = useIssueNavStack((state) => state.reconcile);
  const clear = useIssueNavStack((state) => state.clear);

  // Reconcile only when the route id changes (deps = [issueId]); reading the
  // store imperatively here keeps a drill's own store write from re-firing this
  // on the outgoing sheet mid-transition (which would wipe the just-pushed
  // trail). A drill/back already set `currentId` to this id, so those are no-ops;
  // any other arrival resets to a depth-0 trail.
  useEffect(() => {
    reconcile(issueId);
  }, [issueId, reconcile]);

  // Only trust the trail when it actually describes the on-screen issue, so a
  // cross-navigation that hasn't reconciled yet never flashes a stale Back.
  const backTo =
    currentId === issueId && trail.length > 0
      ? (trail[trail.length - 1] ?? null)
      : null;

  const goBack = useCallback(() => {
    const previous = back();
    if (previous) {
      router.replace(buildOpenIssueHref(previous, searchParams));
    }
  }, [back, router, searchParams]);

  const exit = useCallback(() => {
    clear();
    onExit();
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
