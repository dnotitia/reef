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
      data-priority={priority}
      role="status"
      className={`mb-3 flex min-w-0 flex-col gap-2 border-b border-border-subtle py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
        secondary ? "bg-surface-page" : "bg-surface-subtle/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`type-control font-medium text-foreground ${
            locale === "ko"
              ? "[overflow-wrap:anywhere] [word-break:keep-all]"
              : "[overflow-wrap:anywhere]"
          }`}
        >
          {t("nudgeTitle", { name: sprint.name })}
        </p>
        <p
          className={
            locale === "ko"
              ? "mt-0.5 type-caption text-muted-foreground [overflow-wrap:anywhere] [word-break:keep-all]"
              : "mt-0.5 type-caption text-muted-foreground [overflow-wrap:anywhere]"
          }
        >
          {t("nudgeDescription", { count })}
        </p>
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
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
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissedSprintId(sprint.id)}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}
