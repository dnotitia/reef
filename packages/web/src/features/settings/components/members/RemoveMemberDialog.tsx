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
import type { VaultMember } from "@reef/core";

interface RemoveMemberDialogProps {
  /** The member pending removal, or null when the dialog is closed. */
  member: VaultMember | null;
  vault: string;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirm step for member removal (REEF-179). A single dialog instance at the
 * section level (driven by the section's `removeTarget` state) rather than one
 * per row. Default focus rests on Cancel so the destructive action is does not the
 * accidental Enter target.
 */
export function RemoveMemberDialog({
  member,
  vault,
  isPending,
  onConfirm,
  onClose,
}: RemoveMemberDialogProps) {
  const name = member ? member.display_name?.trim() || member.username : "";

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-md"
        data-testid="remove-member-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Remove {name} from {vault}?
          </DialogTitle>
          <DialogDescription>
            They&apos;ll lose access to this workspace&apos;s issues. You can
            add them back anytime.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="remove-member-confirm"
          >
            {isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
