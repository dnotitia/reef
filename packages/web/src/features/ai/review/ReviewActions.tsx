"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Pencil, RefreshCcw, Save, Square, X } from "lucide-react";

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

const busyLabelByAction = {
  approve: "Approving...",
  dismiss: "Dismissing...",
  edit: "Editing...",
  retry: "Retrying...",
  cancel: "Cancelling...",
  save: "Saving...",
} satisfies Record<ReviewActionId, string>;

export function ReviewActions({
  actions,
  compact = false,
  className,
}: ReviewActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div
      data-testid="review-actions"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {actions.map((action) => {
        const Icon = iconByAction[action.id];
        const label = action.busy
          ? (action.busyLabel ?? busyLabelByAction[action.id])
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
