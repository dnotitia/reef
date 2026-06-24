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
import { useTranslations } from "next-intl";

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
  const t = useTranslations("settings.members");
  const c = useTranslations("common");
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
            {t("removeConfirm", { name, workspace: vault })}
          </DialogTitle>
          <DialogDescription>{t("removeDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            {c("cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="remove-member-confirm"
          >
            {isPending ? t("removing") : c("remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
