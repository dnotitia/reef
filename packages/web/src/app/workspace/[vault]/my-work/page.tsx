import { MyWorkPage } from "@/features/my-work/components/MyWorkPage";
import { MyWorkPageSkeleton } from "@/features/my-work/components/MyWorkPageSkeleton";
import { Suspense } from "react";

export default function Page() {
  // MyWorkPage reads `?group=` via useSearchParams, so it needs a Suspense
  // boundary like the issues workspace. The skeleton fallback fills the body
  // while that boundary is suspended on a hard nav instead of blanking it
  // (REEF-255).
  return (
    <Suspense fallback={<MyWorkPageSkeleton />}>
      <MyWorkPage />
    </Suspense>
  );
}
