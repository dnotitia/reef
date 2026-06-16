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
import type { PlanningItem } from "../hooks/usePlanningCatalog";

export function PlanningDeleteDialog({
  target,
  kindSingular,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  target: PlanningItem | null;
  kindSingular: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const noun = kindSingular.toLowerCase();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) onCancel();
      }}
    >
      <DialogContent
        data-testid="planning-delete-confirm"
        className="max-w-md gap-4"
        onInteractOutside={(e) => {
          if (isDeleting) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isDeleting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Delete {noun}
            {target ? ` “${target.name}”` : ""}?
          </DialogTitle>
          <DialogDescription>
            This permanently removes the {noun} from the workspace. It can’t be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isDeleting}
            data-testid="planning-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isDeleting}
            data-testid="planning-delete-confirm-btn"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
