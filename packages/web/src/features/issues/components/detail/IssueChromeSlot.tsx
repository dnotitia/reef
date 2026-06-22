"use client";

import { createContext, useContext } from "react";

/**
 * The sheet-owned DOM node into which the loaded issue body portals its action
 * cluster (save status + ⋮ menu) so the persistent chrome bar stays a single
 * instance while the body swaps skeleton → loaded below it (REEF-286).
 *
 * `null` means "no chrome bar in scope" — either the bar's slot has not mounted
 * yet, or the body is rendered standalone (unit tests render `IssueDetail`
 * without the sheet). In that case the action cluster falls back to rendering
 * in-flow rather than portaling, so a header-less render still shows the actions.
 */
const IssueChromeSlotContext = createContext<HTMLElement | null>(null);

export const IssueChromeSlotProvider = IssueChromeSlotContext.Provider;

export function useIssueChromeSlot(): HTMLElement | null {
  return useContext(IssueChromeSlotContext);
}
