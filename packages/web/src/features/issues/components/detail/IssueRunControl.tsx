"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  IssueRunRequestEligibility,
  IssueRunRequestEligibilityReason,
} from "@reef/core";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RunIssueDialog } from "./RunIssueDialog";

const REASON_KEYS = {
  not_authorized: "reasons.notAuthorized",
  not_assignee: "reasons.notAssignee",
  issue_archived: "reasons.issueArchived",
  issue_document_unavailable: "reasons.documentUnavailable",
  issue_type_not_runnable: "reasons.typeNotRunnable",
  issue_status_not_todo: "reasons.statusNotTodo",
  unresolved_dependencies: "reasons.dependenciesUnresolved",
  target_missing: "reasons.targetMissing",
  target_disabled: "reasons.targetDisabled",
  target_invalid: "reasons.targetInvalid",
  profile_unavailable: "reasons.profileUnavailable",
  run_already_active: "reasons.alreadyActive",
} as const satisfies Record<IssueRunRequestEligibilityReason, string>;

export function issueRunReasonMessage(
  t: ReturnType<typeof useTranslations<"issues.run">>,
  reason: IssueRunRequestEligibilityReason,
): string {
  return t(REASON_KEYS[reason]);
}

export function IssueRunAvailabilityNotice({
  eligibility,
  isError,
  noticeId,
}: {
  eligibility: IssueRunRequestEligibility | undefined;
  isError: boolean;
  noticeId: string;
}) {
  const t = useTranslations("issues.run");
  const reason = eligibility?.reasons[0];
  if (!isError && reason == null) return null;
  return (
    <p
      id={noticeId}
      data-testid="issue-run-unavailable-reason"
      className="rounded-sm border-l-2 border-brand/50 bg-brand/[0.04] px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">{t("unavailable")}</span>{" "}
      {isError || reason == null
        ? t("eligibilityLoadFailed")
        : issueRunReasonMessage(t, reason)}
    </p>
  );
}

export function IssueRunControl({
  issueId,
  vault,
  eligibility,
  isPending,
  isError,
  noticeId,
}: {
  issueId: string;
  vault: string;
  eligibility: IssueRunRequestEligibility | undefined;
  isPending: boolean;
  isError: boolean;
  noticeId: string;
}) {
  const t = useTranslations("issues.run");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedGithubId, setSelectedGithubId] = useState<number | null>(null);

  if (isPending) {
    return <Skeleton className="h-7 w-32 shrink-0" />;
  }

  const activeRun = eligibility?.active_run;
  const reason = eligibility?.reasons[0];
  const options = eligibility?.target_options ?? [];
  const disabled = isError || !eligibility?.eligible;
  const summary =
    options.length === 1
      ? options[0]?.repo
      : t("targetCount", { count: options.length });

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      {activeRun ? (
        <span className="max-w-32 truncate text-[11px] font-medium text-brand">
          {t(`status.${activeRun.status}`)}
        </span>
      ) : options.length > 0 ? (
        <span className="hidden max-w-36 truncate text-[11px] text-muted-foreground xl:inline">
          {summary}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        data-testid="issue-run-trigger"
        aria-disabled={disabled}
        aria-describedby={disabled ? noticeId : undefined}
        className="h-7 gap-1.5 bg-brand px-2.5 text-xs text-white hover:bg-brand/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => {
          if (disabled) return;
          setSelectedGithubId(
            eligibility?.default_target_github_id ?? selectedGithubId,
          );
          setDialogOpen(true);
        }}
      >
        <Play className="size-3 fill-current" />
        {activeRun ? t("queued") : t("run")}
      </Button>
      {eligibility ? (
        <RunIssueDialog
          issueId={issueId}
          vault={vault}
          open={dialogOpen}
          options={options}
          selectedGithubId={selectedGithubId}
          onSelectedGithubIdChange={setSelectedGithubId}
          onOpenChange={setDialogOpen}
        />
      ) : null}
      {reason ? (
        <span className="sr-only">{issueRunReasonMessage(t, reason)}</span>
      ) : null}
    </div>
  );
}
