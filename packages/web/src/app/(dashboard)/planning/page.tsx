import { PlanningPage } from "@/features/planning/components/PlanningPage";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense>
      <PlanningPage />
    </Suspense>
  );
}
