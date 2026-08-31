"use client";

import { IssueChangeReviewPage } from "@/features/issues/components/change-review/IssueChangeReviewPage";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

function ChangeReviewLoading() {
  const t = useTranslations("issues.changeReview");
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-testid="issue-change-review-loading-shell"
    >
      <div className="h-12 shrink-0 border-b border-border-subtle bg-surface-page" />
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground" role="status">
          {t("loading")}
        </p>
      </main>
    </div>
  );
}

export default function IssueChangeReviewRoute() {
  return (
    <Suspense fallback={<ChangeReviewLoading />}>
      <IssueChangeReviewPage />
    </Suspense>
  );
}
