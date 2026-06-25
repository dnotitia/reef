"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { AgentRunState } from "../runtime/types";
import { type ReviewAction, ReviewActions } from "./ReviewActions";

export interface RunStatusIndicatorProps {
  state: AgentRunState;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}

const phaseLabelKey = {
  idle: "phaseIdle",
  running: "phaseRunning",
  completed: "phaseCompleted",
  empty: "phaseEmpty",
  error: "phaseError",
  cancelled: "phaseCancelled",
} satisfies Record<AgentRunState["phase"], string>;

const phaseClass = {
  idle: "border-border bg-elevated text-muted-foreground",
  running: "border-ai-border bg-ai-subtle text-ai-subtle-foreground",
  completed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  empty: "border-border bg-elevated text-muted-foreground",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-elevated text-muted-foreground",
} satisfies Record<AgentRunState["phase"], string>;

export function RunStatusIndicator({
  state,
  onRetry,
  onCancel,
  className,
}: RunStatusIndicatorProps) {
  // The phase label key is built from the run phase at runtime, so the typed
  // namespace translator does not carry it — cast to a plain lookup (the
  // `i18n/fieldLabels` pattern); `artifactCount` is a normal interpolated key.
  const t = useTranslations("ai") as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const common = useTranslations("common");
  const actions: ReviewAction[] = [];
  if (state.phase === "running" && onCancel) {
    actions.push({ id: "cancel", label: common("cancel"), onClick: onCancel });
  }
  if (
    state.phase === "error" &&
    onRetry &&
    state.error?.recoverable !== false
  ) {
    actions.push({ id: "retry", label: common("retry"), onClick: onRetry });
  }

  return (
    <div
      data-testid="run-status-indicator"
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge
          className={cn("px-2 py-0.5 text-[11px]", phaseClass[state.phase])}
        >
          {t(phaseLabelKey[state.phase])}
        </Badge>
        {state.artifact_ids.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t("artifactCount", { count: state.artifact_ids.length })}
          </span>
        )}
        {state.error && (
          <span className="min-w-0 break-words text-xs text-destructive">
            {state.error.message}
          </span>
        )}
      </div>
      <ReviewActions actions={actions} compact />
    </div>
  );
}
