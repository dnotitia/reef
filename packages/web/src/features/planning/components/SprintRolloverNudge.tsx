"use client";

import { Button } from "@/components/ui/button";
import {
  shouldShowSprintRolloverNudge,
  summarizeSprintRolloverIssues,
  type IssueListItem,
  type Sprint,
} from "@reef/core";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export function SprintRolloverNudge({
  sprint,
  issues,
  issueState,
  now,
  canEdit,
  priority = "primary",
  onOpen,
}: {
  sprint: Sprint | null;
  issues: readonly IssueListItem[] | undefined;
  issueState: "loading" | "error" | "available";
  now: number | null;
  canEdit: boolean;
  priority?: "primary" | "secondary";
  onOpen: (sprint: Sprint) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("planning.rollover");
  const [dismissedSprintId, setDismissedSprintId] = useState<string | null>(
    null,
  );
  const sprintId = sprint?.id;
  const dismissed = sprintId !== undefined && dismissedSprintId === sprintId;

  if (
    dismissed ||
    !sprint ||
    issueState !== "available" ||
    !issues ||
    now === null ||
    !shouldShowSprintRolloverNudge({ sprint, issues, now })
  ) {
    return null;
  }

  const count = summarizeSprintRolloverIssues(issues, sprint.id).eligible;
  const disabledReason = canEdit ? undefined : t("readerDisabled");
  const secondary = priority === "secondary";

  return (
    <div
      data-testid="sprint-rollover-nudge"
      role="status"
      className={
        secondary
          ? "relative mb-3 flex min-h-[132px] flex-col items-stretch gap-2 rounded-md border border-border-subtle bg-surface-subtle/60 px-3 py-2.5 sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pr-12"
          : "relative mb-3 flex min-h-[132px] flex-col items-stretch gap-2 rounded-md border border-status-in-progress-focus/40 bg-status-in-progress-fill/5 px-3 py-2.5 sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pr-12"
      }
    >
      <div className="min-w-0 flex-1 pr-10">
        <p
          className={
            secondary
              ? "type-control font-medium text-foreground"
              : "type-body font-medium text-foreground"
          }
        >
          {t("nudgeTitle", { name: sprint.name })}
        </p>
        <p
          className={
            locale === "ko"
              ? "mt-0.5 type-caption text-muted-foreground [overflow-wrap:anywhere] [word-break:keep-all]"
              : "mt-0.5 type-caption text-muted-foreground"
          }
        >
          {t("nudgeDescription", { count })}
        </p>
      </div>
      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
        <Button
          type="button"
          size="sm"
          variant={secondary ? "outline" : "default"}
          className="w-full sm:w-auto"
          onClick={() => onOpen(sprint)}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          title={disabledReason}
        >
          {t("action")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          hitTarget="coarse"
          aria-label={t("dismissNudge")}
          className="absolute top-1 right-1 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissedSprintId(sprint.id)}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}
