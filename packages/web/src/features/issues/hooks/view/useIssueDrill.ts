"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, useCallback } from "react";
import { buildOpenIssueHref } from "../../lib/issueHref";
import { useIssueNavStack } from "../../stores/useIssueNavStack";

/**
 * Drill from the issue currently shown in the detail sheet into a related issue
 * (REEF-270). Returns a prop factory the in-sheet relationship links (parent
 * breadcrumb, sub-issues) spread onto their `<Link>`:
 *
 *  - `href` carries the active `?view=` (+ filters) via `buildOpenIssueHref`, so
 *    a modifier/middle click opening a new tab lands on a deep link whose
 *    backdrop keeps the originating view instead of the Board default (REEF-222),
 *    and starts a fresh depth-0 trail.
 *  - `onClick` (plain left click) records the hop on the in-memory nav stack
 *    and swaps the active issue in place. Base-route sessions replace only the
 *    URL with Next's native history integration so their Sheet stays mounted;
 *    intercepted sessions use `router.replace`. Both keep browser history flat
 *    (list ⇄ sheet), so Close returns to the list in one step.
 *
 * Modifier / non-primary clicks fall through to the anchor's native behavior
 * (open in a new tab/window), matching every other reef relation link.
 */
export function useIssueDrill(fromIssueId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { vault } = useActiveVault();
  const drill = useIssueNavStack((state) => state.drill);
  const entryRoute = useIssueNavStack((state) => state.entryRoute);

  return useCallback(
    (targetId: string) => {
      const href = buildOpenIssueHref(vault, targetId, searchParams);
      return {
        href,
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          // Let the browser handle anything that isn't a plain left click so
          // cmd/ctrl/shift/middle-click still opens a new tab (a fresh deep link).
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          drill(fromIssueId, targetId);
          if (entryRoute === "base") {
            // A hard-open detail already owns a live base-route sheet. Replace
            // only the URL so the sheet survives the first relationship move;
            // Next synchronizes native history updates with pathname/search hooks.
            window.history.replaceState(null, "", href);
          } else {
            router.replace(href);
          }
        },
      };
    },
    [router, searchParams, vault, drill, fromIssueId, entryRoute],
  );
}
