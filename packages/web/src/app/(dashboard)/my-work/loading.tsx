import { MyWorkPageSkeleton } from "@/features/my-work/components/MyWorkPageSkeleton";

/** Route-level loading UI for /my-work (REEF-255) — see /issues loading. */
export default function Loading() {
  return <MyWorkPageSkeleton />;
}
