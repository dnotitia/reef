"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { buildOpenIssueHref } from "../../lib/issueHref";

/**
 * Returns a navigator that opens an issue's detail sheet while preserving the
 * current `?view=` (and filter/sort) query. The peer issue views read their
 * active tab from `?view=`, so a soft-nav `push("/issues/{id}")` that dropped
 * the query made the backdrop re-render as the Board default; carrying the
 * query keeps the originating tab (REEF-222).
 */
export function useOpenIssue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  return useCallback(
    (id: string) => {
      router.push(buildOpenIssueHref(id, searchParams));
    },
    [router, searchParams],
  );
}
