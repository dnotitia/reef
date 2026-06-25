"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Pencil, RefreshCcw, Save, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";

export type ReviewActionId =
  | "approve"
  | "dismiss"
  | "edit"
  | "retry"
  | "cancel"
  | "save";

export interface ReviewAction {
  id: ReviewActionId;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  testId?: string;
}

export interface ReviewActionsProps {
  actions: ReviewAction[];
  compact?: boolean;
  className?: string;
}

const iconByAction = {
  approve: Check,
  dismiss: X,
  edit: Pencil,
  retry: RefreshCcw,
  cancel: Square,
  save: Save,
} satisfies Record<ReviewActionId, typeof Check>;

const variantByAction = {
  approve: "default",
  dismiss: "outline",
  edit: "outline",
  retry: "outline",
  cancel: "ghost",
  save: "default",
} as const satisfies Record<ReviewActionId, "default" | "outline" | "ghost">;

const busyLabelKeyByAction = {
  approve: "approving",
  dismiss: "dismissing",
  edit: "editing",
  retry: "retrying",
  cancel: "cancelling",
  save: "saving",
} satisfies Record<ReviewActionId, string>;

export function ReviewActions({
  actions,
  compact = false,
  className,
}: ReviewActionsProps) {
  // The busy-fallback label key is built from the action id at runtime, so the
  // typed namespace translator does not carry it — cast to a plain key→string
  // lookup (the `i18n/fieldLabels` pattern).
  const t = useTranslations("ai") as unknown as (key: string) => string;
  if (actions.length === 0) return null;

  return (
    <div
      data-testid="review-actions"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {actions.map((action) => {
        const Icon = iconByAction[action.id];
        const label = action.busy
          ? (action.busyLabel ?? t(busyLabelKeyByAction[action.id]))
          : action.label;
        return (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant={variantByAction[action.id]}
            disabled={action.disabled || action.busy}
            onClick={action.onClick}
            aria-label={label}
            data-testid={action.testId}
            className={cn(
              compact && "h-6 px-2 text-[11px]",
              action.id === "approve" &&
                "bg-ai text-ai-foreground hover:bg-ai/90",
            )}
          >
            <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
