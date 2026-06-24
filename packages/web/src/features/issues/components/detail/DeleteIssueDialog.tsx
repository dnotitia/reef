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
import { useTranslations } from "next-intl";

export function DeleteIssueDialog({
  open,
  issueId,
  isDeleting,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  issueId: string;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("issues.detailDialogs");
  const c = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="issue-delete-confirm"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>
            {c("delete")} {issueId}?
          </DialogTitle>
          <DialogDescription>
            {t.rich("deleteDescription", {
              archive: (chunks) => (
                <span className="font-medium">{chunks}</span>
              ),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isDeleting}
            data-testid="issue-delete-cancel"
          >
            {c("cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isDeleting}
            data-testid="issue-delete-confirm-btn"
          >
            {isDeleting ? t("deleting") : c("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
