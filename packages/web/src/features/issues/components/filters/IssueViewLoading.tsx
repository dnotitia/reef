"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { BacklogTableSkeleton } from "@/features/issues/components/filters/BacklogTableSkeleton";
import { IssueListViewSkeleton } from "@/features/issues/components/list/IssueListViewSkeleton";
import { TimelineViewSkeleton } from "@/features/timeline/components/TimelineGridSkeleton";
import { LazyLoadFallback } from "@/features/ui/components/LazyLoadFallback";
import { useTranslations } from "next-intl";

type IssueViewLoadingName = "board" | "list" | "backlog" | "timeline";

interface IssueViewLoadingProps {
  name: IssueViewLoadingName;
  error?: Error | null;
  retry?: () => void;
}

export function IssueViewLoading({
  name,
  error,
  retry,
}: IssueViewLoadingProps) {
  const common = useTranslations("common");

  if (error) {
    return (
      <LazyLoadFallback
        error={error}
        retry={retry}
        surface="view"
        testId={`issues-${name}-loading`}
      />
    );
  }

  return (
    <div
      data-testid={`issues-${name}-loading`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <span className="sr-only">{common("loading")}</span>
      {name === "board" ? <BoardColumnsSkeleton /> : null}
      {name === "list" ? <IssueListViewSkeleton /> : null}
      {name === "backlog" ? <BacklogTableSkeleton /> : null}
      {name === "timeline" ? <TimelineViewSkeleton /> : null}
    </div>
  );
}
