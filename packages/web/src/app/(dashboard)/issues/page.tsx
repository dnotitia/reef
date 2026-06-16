"use client";

import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { Suspense } from "react";

/**
 * /issues — the unified issues workspace. Board / List / Timeline are peer
 * renderings of the same collection, switched via `?view=`. Wrapped in
 * Suspense because IssuesWorkspace reads useSearchParams().
 */
export default function IssuesPage() {
  return (
    <Suspense>
      <IssuesWorkspace />
    </Suspense>
  );
}
