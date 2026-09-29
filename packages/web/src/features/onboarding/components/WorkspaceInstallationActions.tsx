"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { WorkspaceInstallationStatusEnum } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const StatusResponseSchema = z.object({
  installation_status: WorkspaceInstallationStatusEnum,
});

const CommandResponseSchema = StatusResponseSchema.extend({
  command_status: z.enum(["accepted", "already_applied"]),
  replayed: z.boolean(),
});

type InstallMode = "install" | "restore" | "fresh";
type InstallationStatus = z.infer<typeof WorkspaceInstallationStatusEnum>;

interface WorkspaceInstallationActionsProps {
  vault: string;
  initialStatus: InstallationStatus;
  canManage: boolean;
  onReady?: () => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function WorkspaceInstallationActions({
  vault,
  initialStatus,
  canManage,
  onReady,
}: WorkspaceInstallationActionsProps) {
  const t = useTranslations("workspaceInstallation");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finishStarted = useRef(false);
  const finishDone = useRef(false);
  const endpoint = `/api/vaults/${encodeURIComponent(vault)}/installation`;

  const finishWorkspace = useCallback(async () => {
    if (!onReady || finishStarted.current || finishDone.current) return;
    finishStarted.current = true;
    setFinishing(true);
    setError(null);
    try {
      await onReady();
      finishDone.current = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("finishFailed"));
    } finally {
      finishStarted.current = false;
      setFinishing(false);
    }
  }, [onReady, t]);

  const readStatus = useCallback(async (): Promise<InstallationStatus> => {
    const response = await apiFetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      await throwHttpError(
        response,
        `GET installation returned ${response.status}`,
      );
    }
    const next = StatusResponseSchema.parse(
      await response.json(),
    ).installation_status;
    setStatus(next);
    await queryClient.invalidateQueries({ queryKey: ["vaults"] });
    return next;
  }, [endpoint, queryClient]);

  const pollUntilSettled = useCallback(async () => {
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
    if (initialStatus !== "installing" && initialStatus !== "upgrading") return;
    setBusy(true);
    void pollUntilSettled()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : t("statusFailed"));
      })
      .finally(() => setBusy(false));
  }, [initialStatus, pollUntilSettled, t]);

  async function runCommand(mode: InstallMode) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  const checkStatus = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  const statusLabel = t(`status.${status}`);
  const statusDescription = t(`description.${status}`);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle/50 px-4 py-4"
      aria-labelledby={`installation-${vault}-heading`}
      data-testid={`workspace-installation-${vault}`}
      data-status={status}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`installation-${vault}-heading`}
              className="type-settings-section text-foreground"
            >
              {t("title")}
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 type-caption text-muted-foreground">
              {statusLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{statusDescription}</p>
        </div>
        {(busy || finishing) && (
          <span
            className="inline-flex items-center gap-2 type-caption text-muted-foreground"
            role="status"
          >
            <Spinner aria-hidden="true" />
            {finishing ? t("finishing") : t("checking")}
          </span>
        )}
      </div>

      {acknowledgement && (
        <p className="text-xs text-muted-foreground" role="status">
          {acknowledgement}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canManage && status === "not_installed" && (
          <Button
            type="button"
            size="sm"
            disabled={busy || finishing}
            onClick={() => void runCommand("install")}
            data-testid={`installation-${vault}-approve`}
          >
            {t("button.install")}
          </Button>
        )}
        {canManage && status === "uninstalled" && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy || finishing}
              onClick={() => void runCommand("restore")}
              data-testid={`installation-${vault}-restore`}
            >
              {t("button.restore")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || finishing}
              onClick={() => void runCommand("fresh")}
              data-testid={`installation-${vault}-fresh`}
            >
              {t("button.fresh")}
            </Button>
          </>
        )}
        {(status === "installing" ||
          status === "upgrading" ||
          status === "unknown") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || finishing}
            onClick={() => void checkStatus()}
          >
            {t("button.checkStatus")}
          </Button>
        )}
        {onReady && status === "ready" && !finishDone.current && !finishing && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void finishWorkspace()}
            data-testid={`installation-${vault}-finish`}
          >
            {t("button.finish")}
          </Button>
        )}
      </div>
    </section>
  );
}
