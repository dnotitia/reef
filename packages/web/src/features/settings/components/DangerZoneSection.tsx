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
 * Two workspace lifecycle actions with distinct consequences: uninstall keeps
 * AKB-owned data for restore; delete removes the whole vault. AKB enforces the
 * owner/admin floor on the underlying calls.
 */
export function DangerZoneSection({ vault }: DangerZoneSectionProps) {
  const t = useTranslations("settings.dangerZone");
  const { role, isResolving } = useWorkspaceAccess(vault);
  const { deleteWorkspace, uninstallReef } = useWorkspaceTeardown(vault);
  const [action, setAction] = useState<WorkspaceDestructiveMode | null>(null);

  // AKB remains the final authorization boundary for each request.
  if (!vault || isResolving || (role !== "owner" && role !== "admin"))
    return null;

  const isPending = deleteWorkspace.isPending || uninstallReef.isPending;

  const confirm = () => {
    if (action === "delete") deleteWorkspace.mutate();
    else if (action === "uninstall") uninstallReef.mutate();
  };

  return (
    <section className="flex flex-col gap-3" data-testid="danger-zone-section">
      <h3 className="type-settings-section text-destructive-text">
        {t("title")}
      </h3>

      <div className="flex flex-col rounded-lg border border-destructive-focus/30 bg-surface-subtle/40">
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {t("uninstall.label")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("uninstall.blurb")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setAction("uninstall")}
            data-testid="danger-zone-uninstall"
          >
            {t("uninstall.button")}
          </Button>
        </div>

        {role === "owner" && (
          <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                {t("delete.label")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("delete.blurb")}
              </p>
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
        )}
      </div>

      <WorkspaceDestructiveDialog
        // Remount per opened action so the type-to-confirm field does not carry
        // over between attempts.
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
