"use client";

import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { useEffect } from "react";

/**
 * Required by App Router for parallel routes with no match at the current URL.
 * Returning null prevents a 404 when no intercepting route is active.
 *
 * It also owns one drill-nav session boundary (REEF-270): this slot is mounted
 * exactly when no issue detail is intercepted — i.e. the list/backdrop is what's
 * showing — and it is *unmounted* throughout a drill (the `(.)issues/[id]` slot
 * stays matched as the panel swaps issue to issue). So mounting here means the
 * sheet just left and the list came back, by any path including a browser Back
 * that pops the modal without running Close. Clearing the in-memory trail here
 * guarantees the next fresh open starts at depth 0 even when it reopens the very
 * issue a stale trail was last left on. `clear()` is idempotent, so StrictMode's
 * double-invoked mount effect is harmless.
 */
export default function ModalDefault() {
  const clear = useIssueNavStack((state) => state.clear);
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
