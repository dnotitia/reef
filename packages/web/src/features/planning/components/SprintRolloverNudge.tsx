"use client";

import { Button } from "@/components/ui/button";
import {
  shouldShowSprintRolloverNudge,
  summarizeSprintRolloverIssues,
  type IssueListItem,
  type Sprint,
} from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function SprintRolloverNudge({
  sprint,
  issues,
  issueState,
  now,
  canEdit,
  onOpen,
}: {
  sprint: Sprint | null;
  issues: readonly IssueListItem[] | undefined;
  issueState: "loading" | "error" | "available";
  now: number | null;
  canEdit: boolean;
  onOpen: (sprint: Sprint) => void;
}) {
  const t = useTranslations("planning.rollover");
  const [dismissed, setDismissed] = useState(false);
  const sprintId = sprint?.id;

  useEffect(() => {
    if (sprintId) setDismissed(false);
  }, [sprintId]);

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

  return (
    <aside
      data-testid="sprint-rollover-nudge"
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-in-progress-focus/40 bg-status-in-progress-fill/5 px-3 py-2.5"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{t("nudgeTitle")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("nudgeDescription", { count })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onOpen(sprint)}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          title={disabledReason}
        >
          {t("action")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t("dismissNudge")}
          onClick={() => setDismissed(true)}
        >
          ×
        </Button>
      </div>
    </aside>
  );
}
