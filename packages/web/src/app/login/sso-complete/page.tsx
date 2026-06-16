import { Suspense } from "react";
import { SsoCompleteClient, SsoCompletionStatus } from "./SsoCompleteClient";

export default function SsoCompletePage() {
  return (
    <Suspense fallback={<SsoCompletionStatus />}>
      <SsoCompleteClient />
    </Suspense>
  );
}
