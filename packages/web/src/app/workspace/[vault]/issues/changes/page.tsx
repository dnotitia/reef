"use client";

import {
  IssueChangeReviewLoading,
  IssueChangeReviewPage,
} from "@/features/issues/components/change-review/IssueChangeReviewPage";
import { Suspense } from "react";

export default function IssueChangeReviewRoute() {
  return (
    <Suspense fallback={<IssueChangeReviewLoading />}>
      <IssueChangeReviewPage />
    </Suspense>
  );
}
