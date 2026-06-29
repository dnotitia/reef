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
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

export type WorkspaceDestructiveMode = "delete" | "detach";

interface WorkspaceDestructiveDialogProps {
  /** Which destructive action this confirm step commits. */
  mode: WorkspaceDestructiveMode;
  open: boolean;
  vault: string;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Shared confirm step for the two workspace-lifecycle danger actions
 * (REEF-322), parameterized by `mode`:
 *
 *  - `delete` — permanent full-vault delete. Guarded by a type-the-name gate
 *    (the confirm button stays disabled until the input matches the vault) and a
 *    destructive-tinted blast-radius inventory of what is removed.
 *  - `detach` — remove the reef layer only; the vault and non-reef content
 *    survive. Recoverable, so it is a single step (no typing) with a neutral
 *    "stays in the vault" inventory.
 *
 * The friction gradient — typed gate vs single step — is the signal that delete
 * is permanent and detach is not.
 */
export function WorkspaceDestructiveDialog({
  mode,
  open,
  vault,
  isPending,
  onConfirm,
  onClose,
}: WorkspaceDestructiveDialogProps) {
  const t = useTranslations("settings.dangerZone");
  const c = useTranslations("common");
  const inputId = useId();
  // The type-to-confirm field starts empty on every mount. The parent remounts
  // this dialog (via a `key` tied to the open action), so a previous attempt
  // never pre-arms the next one — no reset effect needed.
  const [typed, setTyped] = useState("");

  const isDelete = mode === "delete";
  const nameConfirmed = !isDelete || typed.trim() === vault;
  const canConfirm = nameConfirmed && !isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-md"
        data-testid="workspace-destructive-dialog"
        data-mode={mode}
      >
        <DialogHeader>
          <DialogTitle>
            {isDelete
              ? t("delete.confirmTitle", { workspace: vault })
              : t("detach.confirmTitle", { workspace: vault })}
          </DialogTitle>
          <DialogDescription>
            {isDelete
              ? t("delete.confirmDescription")
              : t("detach.confirmDescription")}
          </DialogDescription>
        </DialogHeader>

        {isDelete ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-foreground/80">
            <p className="font-medium text-destructive">
              {t("delete.removesHeading")}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 leading-relaxed">
              <li>{t("delete.removes1")}</li>
              <li>{t("delete.removes2")}</li>
              <li>{t("delete.removes3")}</li>
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-subtle/60 px-3 py-2.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground/80">
              {t("detach.staysHeading")}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 leading-relaxed">
              <li>{t("detach.stays1")}</li>
              <li>{t("detach.stays2")}</li>
            </ul>
          </div>
        )}

        {isDelete ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-xs text-muted-foreground">
              {t("delete.confirmPrompt", { workspace: vault })}
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={isPending}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono"
              data-testid="workspace-delete-confirm-input"
            />
          </div>
        ) : null}

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
            variant={isDelete ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="workspace-destructive-confirm"
          >
            {isDelete
              ? isPending
                ? t("delete.pending")
                : t("delete.button")
              : isPending
                ? t("detach.pending")
                : t("detach.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
