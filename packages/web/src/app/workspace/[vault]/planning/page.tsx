import { PlanningPage } from "@/features/planning/components/PlanningPage";
import { PlanningPageSkeleton } from "@/features/planning/components/PlanningPageSkeleton";
import { Suspense } from "react";

export default function Page() {
  // PlanningPage reads `?kind=`/`?detail=` via useSearchParams, so it needs a
  // Suspense boundary; the skeleton fallback fills the body while it is
  // suspended on a hard nav instead of blanking it (REEF-255).
  return (
    <Suspense fallback={<PlanningPageSkeleton />}>
      <PlanningPage />
    </Suspense>
  );
}
