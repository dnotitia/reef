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
import {
  useClosedReasonHints,
  useClosedReasonLabels,
} from "@/i18n/fieldLabels";
import type { ClosedReason } from "@reef/core";
import { CLOSED_REASON_OPTIONS } from "@reef/core/fields";
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
  const closedReasonLabels = useClosedReasonLabels();
  const closedReasonHints = useClosedReasonHints();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="close-issue-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close {issueId}</DialogTitle>
          <DialogDescription>
            Pick the reason that should be recorded with this closure.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="closed-reason"
            className="text-xs font-medium text-muted-foreground"
          >
            Close reason
          </label>
          <EnumSelectField
            value={reason}
            onValueChange={(value) => setReason(value as ClosedReason)}
            disabled={disabled}
            options={CLOSED_REASON_OPTIONS}
            // The dropdown options carry a second hint line; the trigger value
            // slot is single-line, so the selected value renders the label
            // alone via `renderValue` (REEF-272).
            renderValue={(option) => <span>{closedReasonLabels[option]}</span>}
            renderItem={(option) => (
              <span className="flex min-w-0 flex-col">
                <span>{closedReasonLabels[option]}</span>
                <span className="truncate text-[11px] font-normal text-muted-foreground">
                  {closedReasonHints[option]}
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
