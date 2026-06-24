"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { formatTimestampMonthDay } from "../../issues/lib/dateHelpers";
import { useActiveVault } from "../hooks/useActiveVault";
import { useVaults } from "../hooks/useVaults";
import {
  useApplyWorkspaceSkillUpdate,
  useWorkspaceSkillStatus,
} from "../hooks/useWorkspaceSkillStatus";

/** akb roles that may write documents/rows — `writer` is the floor. */
const WRITER_ROLES = new Set(["writer", "admin", "owner"]);

/**
 * Workspace AI Instructions — compares the vault's installed agent-playbook
 * (vault-skill) version against the running release and lets a writer apply the
 * update. The skill is read by agents, not the PM, so drift is invisible until
 * this surface shows it. Reuses the status-dot idiom from AiConfigurationStatus.
 */
export function WorkspaceSkillSection() {
  const locale = useLocale();
  const t = useTranslations("toasts");
  const { vault } = useActiveVault();
  const vaultsQuery = useVaults();
  const status = useWorkspaceSkillStatus(vault);
  const apply = useApplyWorkspaceSkillUpdate(vault);
  const [confirming, setConfirming] = useState(false);

  // Derived during render (no effect): the vault role we already hold decides
  // whether the POST would be allowed. This just gates the affordance — akb
  // enforces `writer` server-side regardless.
  const role = vaultsQuery.data?.find((v) => v.name === vault)?.role ?? null;
  const canWrite = role != null && WRITER_ROLES.has(role);

  if (!vault || status.isLoading || vaultsQuery.isLoading) {
    // Placeholder for the resolved two-line status block, matching the skeleton
    // language used across the app's loading states (REEF-255).
    return (
      <div
        data-testid="workspace-skill-skeleton"
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-4 w-64" />
        <Skeleton tone="secondary" className="h-4 w-40" />
      </div>
    );
  }

  if (status.isError || !status.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load workspace instruction status.
      </p>
    );
  }

  const syncedLabel = formatTimestampMonthDay(status.data.synced_at, locale);

  if (status.data.up_to_date) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          This workspace runs the current AI playbooks.
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-status-done" />
          <span>
            {syncedLabel
              ? `Up to date · last synced ${syncedLabel}`
              : "Up to date"}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-status-in-progress/40 bg-status-in-progress/5 px-3 py-3 text-sm">
      <p className="font-medium text-foreground">
        Newer AI instructions are available.
      </p>
      <p className="mt-1 text-muted-foreground">
        Your workspace agents are still following an older playbook. Updating
        brings them to this release's behavior.
      </p>

      {apply.isError ? (
        <p role="alert" className="mt-2 text-muted-foreground">
          Couldn't update the workspace instructions. Please try again.
        </p>
      ) : null}

      <div className="mt-3">
        {!canWrite ? (
          <p className="text-muted-foreground">
            A workspace member with edit access can apply this update.
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground">
              This replaces the workspace skill docs for everyone and overwrites
              manual edits.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="confirm-skill-update"
                disabled={apply.isPending}
                onClick={() =>
                  apply.mutate(undefined, {
                    onSuccess: () => {
                      setConfirming(false);
                      // State (drift) lives in the badge/box; this toast marks
                      // the one-shot *event* of applying the update (REEF-257).
                      // A single non-reversible success → plain toast.success per
                      // toastFeedback's convention; the failure path keeps its
                      // inline role="alert" below, so it is not doubled here.
                      toast.success(t("skillUpdated"));
                    },
                  })
                }
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:opacity-60"
              >
                {apply.isPending ? "Updating…" : "Apply update"}
              </button>
              <button
                type="button"
                disabled={apply.isPending}
                onClick={() => setConfirming(false)}
                className="rounded-md border border-border bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="update-skill-btn"
            onClick={() => setConfirming(true)}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90"
          >
            Update instructions
          </button>
        )}
      </div>
    </div>
  );
}
