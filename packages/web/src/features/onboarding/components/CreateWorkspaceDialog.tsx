"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

/**
 * Global "New workspace" dialog (REEF-146). Mounted once in the dashboard shell
 * and opened from the sidebar workspace switcher (and, later, Settings —
 * REEF-147) via useViewStore, mirroring the NewIssueDialog pattern so every
 * entry point shares one instance.
 *
 * The body is the shared CreateWorkspaceForm — the same create path onboarding
 * uses — so there is exactly one place that posts to /api/vaults. On success
 * the form already sets the new vault active and navigates to /issues; this
 * dialog needs to close itself.
 */
export function CreateWorkspaceDialog() {
  const t = useTranslations("onboarding");
  const open = useViewStore((s) => s.createWorkspaceDialogOpen);
  const closeDialog = useViewStore((s) => s.closeCreateWorkspaceDialog);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent
        data-testid="create-workspace-dialog"
        className="max-w-lg gap-5"
      >
        <DialogHeader>
          <DialogTitle>{t("newWorkspaceTitle")}</DialogTitle>
          <DialogDescription>{t("newWorkspaceDescription")}</DialogDescription>
        </DialogHeader>

        <CreateWorkspaceForm
          idPrefix="create-workspace"
          onCreated={closeDialog}
          onCancel={closeDialog}
        />
      </DialogContent>
    </Dialog>
  );
}
