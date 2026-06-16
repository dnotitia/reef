"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Discard the draft and close the new-issue dialog. */
  onConfirm: () => void;
  /** Keep the draft and return to editing. */
  onCancel: () => void;
}

/**
 * Confirms discarding an unsaved new-issue draft (REEF-075 / WIG: warn before
 * navigating away from unsaved changes). Shown when the dialog is dismissed —
 * Escape, outside click, or Cancel — while the form has any content. An empty
 * draft closes straight away without this prompt.
 */
export function DiscardDraftDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
}: DiscardDraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="discard-draft-confirm"
        className="max-w-md gap-4"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Discard Draft?</DialogTitle>
          <DialogDescription>
            This issue hasn't been created yet. Your draft will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid="discard-draft-cancel"
          >
            Keep Editing
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            data-testid="discard-draft-confirm-button"
          >
            Discard Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
