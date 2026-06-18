import { MyWorkPage } from "@/features/my-work/components/MyWorkPage";
import { Suspense } from "react";

export default function Page() {
  // MyWorkPage reads `?group=` via useSearchParams, so it needs a Suspense
  // boundary like the issues workspace.
  return (
    <Suspense>
      <MyWorkPage />
    </Suspense>
  );
}
