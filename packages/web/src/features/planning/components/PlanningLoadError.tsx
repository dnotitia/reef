"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useId } from "react";

export function PlanningLoadError({
  testId,
  title,
  description,
  isFetching,
  onRetry,
}: {
  testId: string;
  title: string;
  description: string;
  isFetching: boolean;
  onRetry: () => void;
}) {
  const common = useTranslations("common");
  const retryLabel = common("retry");
  const id = useId();

  return (
    <div
      data-testid={testId}
      role="alert"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive-focus/30 bg-destructive-fill/[0.04] px-3 py-3"
    >
      <div className="min-w-0">
        <h2
          id={`${id}-title`}
          className="text-sm font-medium text-destructive-text"
        >
          {title}
        </h2>
        <p
          id={`${id}-description`}
          className="mt-1 text-sm text-muted-foreground"
        >
          {description}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        busy={isFetching}
        onClick={onRetry}
        aria-label={retryLabel}
      >
        {retryLabel}
      </Button>
    </div>
  );
}
