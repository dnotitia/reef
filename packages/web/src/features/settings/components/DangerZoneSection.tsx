"use client";

import { Button } from "@/components/ui/button";
import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { useWorkspaceTeardown } from "@/features/settings/hooks/useWorkspaceTeardown";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  WorkspaceDestructiveDialog,
  type WorkspaceDestructiveMode,
} from "./WorkspaceDestructiveDialog";

interface DangerZoneSectionProps {
  vault: string;
}

/**
 * Owner-scoped workspace-lifecycle danger zone at the foot of Settings › Workspace
 * (REEF-322). Two destructive actions whose blast radius is encoded in the
 * button weight: detach (outline) removes the reef layer and keeps the akb
 * vault; delete (destructive) removes the whole vault. akb also enforces the
 * admin/owner floor on the underlying calls, so this UI gate matches rather than
 * over-promises. Non-owners (and readers/writers/admins) does not render it.
 */
export function DangerZoneSection({ vault }: DangerZoneSectionProps) {
  const t = useTranslations("settings.dangerZone");
  const { role, isResolving } = useWorkspaceAccess(vault);
  const { deleteWorkspace, detachReef } = useWorkspaceTeardown(vault);
  const [action, setAction] = useState<WorkspaceDestructiveMode | null>(null);

  // Omit until the role resolves so a wrong gate does not flash, and scope it to the
  // owner. No active vault → nothing to act on.
  if (!vault || isResolving || role !== "owner") return null;

  const isPending = deleteWorkspace.isPending || detachReef.isPending;

  const confirm = () => {
    if (action === "delete") deleteWorkspace.mutate();
    else if (action === "detach") detachReef.mutate();
  };

  return (
    <section className="flex flex-col gap-3" data-testid="danger-zone-section">
      <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-destructive">
        {t("title")}
      </h3>

      <div className="flex flex-col rounded-lg border border-destructive/30 bg-surface-subtle/40">
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {t("detach.label")}
            </p>
            <p className="text-xs text-muted-foreground">{t("detach.blurb")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setAction("detach")}
            data-testid="danger-zone-detach"
          >
            {t("detach.button")}
          </Button>
        </div>

        <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {t("delete.label")}
            </p>
            <p className="text-xs text-muted-foreground">{t("delete.blurb")}</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setAction("delete")}
            data-testid="danger-zone-delete"
          >
            {t("delete.button")}
          </Button>
        </div>
      </div>

      <WorkspaceDestructiveDialog
        // Remount per opened action so the type-to-confirm field does not carry
        // over between attempts (and across delete/detach).
        key={action ?? "closed"}
        mode={action ?? "delete"}
        open={action !== null}
        vault={vault}
        isPending={isPending}
        onConfirm={confirm}
        onClose={() => setAction(null)}
      />
    </section>
  );
}
