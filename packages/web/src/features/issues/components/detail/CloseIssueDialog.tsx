"use client";

import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusIcon } from "@/components/ui/status-icon";
import type { ClosedReason } from "@reef/core";
import {
  CLOSED_REASON_HINTS,
  CLOSED_REASON_LABELS,
  CLOSED_REASON_OPTIONS,
} from "@reef/core/fields";
import { useState } from "react";

interface CloseIssueDialogProps {
  open: boolean;
  issueId: string;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: ClosedReason) => void;
}

export function CloseIssueDialog({
  open,
  issueId,
  disabled = false,
  onOpenChange,
  onConfirm,
}: CloseIssueDialogProps) {
  return (
    <CloseIssueDialogContent
      key={open ? issueId : "closed"}
      open={open}
      issueId={issueId}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}

function CloseIssueDialogContent({
  open,
  issueId,
  disabled,
  onOpenChange,
  onConfirm,
}: Required<
  Pick<CloseIssueDialogProps, "open" | "issueId" | "onOpenChange" | "onConfirm">
> &
  Pick<CloseIssueDialogProps, "disabled">) {
  const [reason, setReason] = useState<ClosedReason>("completed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="close-issue-dialog" className="max-w-[420px]">
        <DialogHeader className="gap-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-muted-foreground">
            <StatusIcon status="closed" size={12} />
            Closed
          </div>
          <DialogTitle>Close {issueId}</DialogTitle>
          <DialogDescription>
            Pick the reason that should be recorded with this closure.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border-subtle bg-surface-subtle/60 p-3">
          <label
            htmlFor="closed-reason"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Close reason
          </label>
          <EnumSelectField
            value={reason}
            onValueChange={(value) => setReason(value as ClosedReason)}
            disabled={disabled}
            options={CLOSED_REASON_OPTIONS}
            renderItem={(option) => (
              <span className="flex min-w-0 flex-col">
                <span>{CLOSED_REASON_LABELS[option]}</span>
                <span className="truncate text-[11px] font-normal text-muted-foreground">
                  {CLOSED_REASON_HINTS[option]}
                </span>
              </span>
            )}
            id="closed-reason"
            testId="closed-reason-select"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onOpenChange(false)}
          >
            Keep open
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            data-testid="close-issue-confirm"
            onClick={() => onConfirm(reason)}
          >
            Close issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
