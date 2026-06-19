"use client";

import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { Suspense } from "react";

/**
 * /issues — the unified issues workspace. Board / List / Timeline are peer
 * renderings of the same collection, switched via `?view=`. Wrapped in
 * Suspense because IssuesWorkspace reads useSearchParams(); the skeleton
 * fallback paints the board frame instead of a blank body while that boundary
 * is suspended (hard nav / refresh) — REEF-255.
 */
export default function IssuesPage() {
  return (
    <Suspense fallback={<IssuesWorkspaceSkeleton />}>
      <IssuesWorkspace />
    </Suspense>
  );
}
