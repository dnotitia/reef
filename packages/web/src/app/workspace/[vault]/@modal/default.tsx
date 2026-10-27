"use client";

import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Required by App Router for parallel routes with no match at the current URL.
 * Returning null prevents a 404 when no intercepting route is active.
 *
 * This slot also owns the drill-nav session boundary (REEF-270). It mounts when
 * no intercepted child matches, including on a cold base detail route, so clear
 * the session only after the pathname leaves issue detail. That catches Close
 * and browser Back to the list while preserving the base route's issue and exit
 * owner during a direct-detail relationship drill.
 */
export default function ModalDefault() {
  const clear = useIssueNavStack((state) => state.clear);
  const pathname = usePathname();
  const isIssueDetailPath =
    pathname !== null && /^\/workspace\/[^/]+\/issues\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (!isIssueDetailPath) clear();
  }, [clear, isIssueDetailPath]);

  return null;
}
