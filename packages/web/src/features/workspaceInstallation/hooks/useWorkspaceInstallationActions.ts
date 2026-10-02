"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { WorkspaceInstallationStatusEnum } from "@reef/core";

const StatusResponseSchema = z.object({
  installation_status: WorkspaceInstallationStatusEnum,
});

const CommandResponseSchema = StatusResponseSchema.extend({
  command_status: z.enum(["accepted", "already_applied"]),
  replayed: z.boolean(),
});

export type WorkspaceInstallationStatus = z.infer<
  typeof WorkspaceInstallationStatusEnum
>;
export type InstallationCommand = "install" | "restore" | "fresh";
type Activity = "checking" | "requesting" | "finishing" | null;

interface UseWorkspaceInstallationActionsOptions {
  vault: string;
  initialStatus: WorkspaceInstallationStatus;
  canManage: boolean;
  enabled?: boolean;
  onReady?: () => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useWorkspaceInstallationActions({
  vault,
  initialStatus,
  canManage,
  enabled = true,
  onReady,
}: UseWorkspaceInstallationActionsOptions) {
  const t = useTranslations("workspaceInstallation");
  const vaultsQuery = useVaults({ enabled });
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(initialStatus);
  const [activity, setActivity] = useState<Activity>(null);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const finishStarted = useRef(false);
  const finishDone = useRef(false);
  const endpoint = `/api/vaults/${encodeURIComponent(vault)}/installation`;

  const finishWorkspace = useCallback(async () => {
    if (!onReady || finishStarted.current || finishDone.current) return;
    finishStarted.current = true;
    setActivity("finishing");
    setError(null);
    try {
      await onReady();
      finishDone.current = true;
      setFinished(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("finishFailed"));
    } finally {
      finishStarted.current = false;
      setActivity(null);
    }
  }, [onReady, t]);

  const readStatus =
    useCallback(async (): Promise<WorkspaceInstallationStatus> => {
      const refreshed = await vaultsQuery.refetch();
      const next = refreshed.data?.find(
        (entry) => entry.name === vault,
      )?.installation_status;
      if (refreshed.isError || !next) {
        throw new Error(t("statusFailed"));
      }
      setStatus(next);
      return next;
    }, [t, vault, vaultsQuery.refetch]);

  const pollUntilSettled = useCallback(async () => {
    setActivity("checking");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const next = await readStatus();
      if (next === "ready") {
        await finishWorkspace();
        return;
      }
      if (next !== "installing" && next !== "upgrading") return;
      await delay(1500);
    }
    setError(t("stillRunning"));
  }, [finishWorkspace, readStatus, t]);

  useEffect(() => {
    if (
      !enabled ||
      !canManage ||
      (initialStatus !== "installing" && initialStatus !== "upgrading")
    ) {
      return;
    }
    void pollUntilSettled()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : t("statusFailed"));
      })
      .finally(() => setActivity(null));
  }, [canManage, enabled, initialStatus, pollUntilSettled, t]);

  const runCommand = useCallback(
    async (mode: InstallationCommand) => {
      if (!canManage) return;
      setActivity("requesting");
      setError(null);
      setAcknowledgement(null);
      try {
        const response = await apiFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!response.ok) {
          await throwHttpError(
            response,
            `POST installation returned ${response.status}`,
          );
        }
        const result = CommandResponseSchema.parse(await response.json());
        setStatus(result.installation_status);
        setAcknowledgement(
          result.replayed
            ? t("acknowledgementReplayed")
            : t("acknowledgementAccepted"),
        );
        await queryClient.invalidateQueries({ queryKey: ["vaults"] });
        if (result.installation_status === "ready") {
          await finishWorkspace();
        } else if (
          result.installation_status === "installing" ||
          result.installation_status === "upgrading"
        ) {
          await pollUntilSettled();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("commandFailed"));
      } finally {
        setActivity(null);
      }
    },
    [canManage, endpoint, finishWorkspace, pollUntilSettled, queryClient, t],
  );

  const checkStatus = useCallback(async () => {
    setActivity("checking");
    setError(null);
    try {
      const next = await readStatus();
      if (next === "ready") await finishWorkspace();
      else if (next === "installing" || next === "upgrading") {
        await pollUntilSettled();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("statusFailed"));
    } finally {
      setActivity(null);
    }
  }, [finishWorkspace, pollUntilSettled, readStatus, t]);

  return {
    status,
    activity,
    busy: activity !== null,
    acknowledgement,
    error,
    canFinish: Boolean(onReady) && status === "ready" && !finished,
    runCommand,
    checkStatus,
    finishWorkspace,
  };
}
