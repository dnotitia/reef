import { PlanningPageSkeleton } from "@/features/planning/components/PlanningPageSkeleton";

/** Route-level loading UI for /planning (REEF-255) — see /issues loading. */
export default function Loading() {
  return <PlanningPageSkeleton />;
}
