"use client";

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
 *  - `onClick` (plain left click) records the hop on the in-memory nav
 *    stack and swaps the sheet content with `router.replace`, keeping the browser
 *    history flat (list ⇄ sheet) so Close returns to the list in one step. A
 *    drill is an in-panel content swap, not a new history entry.
 *
 * Modifier / non-primary clicks fall through to the anchor's native behavior
 * (open in a new tab/window), matching every other reef relation link.
 */
export function useIssueDrill(fromIssueId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const drill = useIssueNavStack((state) => state.drill);

  return useCallback(
    (targetId: string) => {
      const href = buildOpenIssueHref(targetId, searchParams);
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
          router.replace(href);
        },
      };
    },
    [router, searchParams, drill, fromIssueId],
  );
}
