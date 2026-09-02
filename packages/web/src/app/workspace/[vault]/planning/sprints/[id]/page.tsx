"use client";

import { Suspense } from "react";
import { SprintDetailPage } from "@/features/planning/components/SprintDetailPage";
import { SprintDetailPageSkeleton } from "@/features/planning/components/SprintDetailPageSkeleton";

export default function SprintDetailRoute() {
  return (
    <Suspense fallback={<SprintDetailPageSkeleton />}>
      <SprintDetailPage />
    </Suspense>
  );
}
