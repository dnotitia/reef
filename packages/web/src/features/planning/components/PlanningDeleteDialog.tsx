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
import type { PlanningItem } from "../hooks/usePlanningCatalog";

export function PlanningDeleteDialog({
  target,
  kindSingular,
  isDeleting,
  focusOriginRef,
  onCancel,
  onConfirm,
}: {
  target: PlanningItem | null;
  kindSingular: string;
  isDeleting: boolean;
  focusOriginRef: { current: HTMLElement | null };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("planning");
  const common = useTranslations("common");
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
        onCloseAutoFocus={(event) => {
          const origin = focusOriginRef.current;
          focusOriginRef.current = null;
          if (!origin?.isConnected) return;
          event.preventDefault();
          origin.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {target
              ? t("deleteTitle", { noun, name: target.name })
              : t("deleteTitleNoName", { noun })}
          </DialogTitle>
          <DialogDescription>
            {t("deleteDescription", { noun })}
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
            {common("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isDeleting}
            busy={isDeleting}
            aria-label={common("delete")}
            data-testid="planning-delete-confirm-btn"
          >
            {isDeleting ? t("deleting") : common("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
