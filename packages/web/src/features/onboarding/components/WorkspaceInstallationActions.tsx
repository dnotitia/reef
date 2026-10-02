"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  ControlPlaneInstallationSchema,
  WorkspaceInstallationStatusEnum,
  type ControlPlaneInstallation,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { formatAbsoluteTime } from "@/lib/relativeTime";
import { InstallationDetailsLoading } from "./WorkspaceInstallationLoading";

const StatusResponseSchema = z.object({
  installation_status: WorkspaceInstallationStatusEnum,
  installation: ControlPlaneInstallationSchema.optional(),
});

const CommandResponseSchema = StatusResponseSchema.extend({
  command_status: z.enum(["accepted", "already_applied"]),
  replayed: z.boolean(),
});

type InstallMode = "install" | "restore" | "fresh";
type InstallationStatus = z.infer<typeof WorkspaceInstallationStatusEnum>;

function InstallationDetails({
  installation,
}: {
  installation: ControlPlaneInstallation;
}) {
  const t = useTranslations("workspaceInstallation.details");
  const locale = useLocale();
  const unknown = t("unknown");
  const releaseValue = (value: ControlPlaneInstallation["desiredRelease"]) =>
    value?.version ?? value?.id ?? unknown;
  const drift = installation.drift;
  const overallStatus = drift?.overall ?? "unknown";
  const observedSchema = drift?.schema.observed;
  const observedSchemaFingerprint = installation.observed?.schemaFingerprint;
  const hasDistinctSnapshotFingerprint =
    observedSchemaFingerprint != null &&
    observedSchemaFingerprint !== observedSchema;

  return (
    <section
      className="flex flex-col gap-4 pt-3 text-left"
      aria-label={t("heading")}
      data-testid="installation-details"
      data-overall-drift={drift?.overall ?? "unknown"}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h4 className="type-control font-medium text-foreground">
          {t("heading")}
        </h4>
        <p
          className="type-caption text-muted-foreground"
          data-testid="installation-overall-drift"
          data-drift-status={overallStatus}
        >
          <span>{t("overallStatus")}: </span>
          <span className="font-medium text-foreground">
            {t(`overall.${overallStatus}`)}
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 border-t border-border-subtle pt-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("observedAt")}</dt>
          <dd className="mt-1 break-all text-foreground">
            {installation.observed?.observedAt ? (
              <time
                data-testid="installation-observed-at"
                dateTime={installation.observed.observedAt}
              >
                {formatAbsoluteTime(installation.observed.observedAt, locale)}
              </time>
            ) : (
              <span data-testid="installation-observed-at">{unknown}</span>
            )}
          </dd>
        </div>
      </dl>

      <InstallationComparisonGroup
        dimension="release"
        status={drift?.release.status}
        fields={[
          {
            id: "installation-release-desired",
            label: t("desiredRelease"),
            value: releaseValue(installation.desiredRelease),
          },
          {
            id: "installation-release-current",
            label: t("currentRelease"),
            value: releaseValue(installation.currentRelease),
          },
          {
            id: "installation-release-observed",
            label: t("observedRelease"),
            value: releaseValue(installation.observed?.release),
          },
        ]}
      />
      <InstallationComparisonGroup
        dimension="schema"
        status={drift?.schema.status}
        fields={[
          {
            id: "installation-schema-expected",
            label: t("desiredSchema"),
            value: drift?.schema.expected ?? unknown,
          },
          {
            id: "installation-schema-observed-value",
            label: t("observedSchema"),
            value: observedSchema ?? unknown,
          },
          ...(hasDistinctSnapshotFingerprint
            ? [
                {
                  id: "installation-snapshot-fingerprint",
                  label: t("observedSchemaFingerprint"),
                  value: observedSchemaFingerprint,
                },
              ]
            : []),
        ]}
      />
      <InstallationComparisonGroup
        dimension="grant"
        status={drift?.grant.status}
        fields={[
          {
            id: "installation-grant-desired",
            label: t("desiredGrant"),
            value: String(
              drift?.grant.desiredGeneration ??
                installation.desiredGrantGeneration ??
                unknown,
            ),
          },
          {
            id: "installation-grant-observed",
            label: t("observedGrant"),
            value: String(
              drift?.grant.observedGeneration ??
                installation.observed?.grantGeneration ??
                unknown,
            ),
          },
        ]}
      />

      {installation.lifecycle === "blocked" && (
        <section
          className="flex flex-col gap-3 border-t border-border-subtle pt-3 text-xs"
          aria-label={t("blocked.operatorHeading")}
          data-testid="installation-blocked-guidance"
        >
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">
              {t("blocked.reasonLabel")}
            </span>
            <p className="font-medium text-destructive-text">
              {t(`blockedReason.${installation.blockedReason ?? "unknown"}`)}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <h5 className="type-control font-medium text-foreground">
              {t("blocked.operatorHeading")}
            </h5>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>{t("blocked.reviewCurrentState")}</li>
              <li>{t("blocked.runPreflight")}</li>
              <li>{t("blocked.resumeRelease")}</li>
              <li>{t("blocked.createNewRelease")}</li>
            </ol>
            <p className="text-muted-foreground">{t("blocked.reasonCaveat")}</p>
          </div>
        </section>
      )}
    </section>
  );
}

function InstallationComparisonGroup({
  dimension,
  status,
  fields,
}: {
  dimension: "release" | "schema" | "grant";
  status: "in_sync" | "mismatch" | "unknown" | undefined;
  fields: Array<{ id: string; label: string; value: string }>;
}) {
  const t = useTranslations("workspaceInstallation.details");
  const headingId = useId();

  return (
    <section
      className="flex flex-col gap-3 border-t border-border-subtle pt-3"
      aria-labelledby={headingId}
      data-testid={`installation-comparison-${dimension}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h5 id={headingId} className="type-control font-medium text-foreground">
          {t(`dimension.${dimension}`)}
        </h5>
        <span
          className="type-caption text-muted-foreground"
          data-drift-status={status ?? "unknown"}
        >
          {t(`driftStatus.${status ?? "unknown"}`)}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        {fields.map(({ id, label, value }) => (
          <div key={id} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all text-foreground" data-testid={id}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

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
  const [installation, setInstallation] = useState<
    ControlPlaneInstallation | undefined
  >();
  const [installationDetailsLoading, setInstallationDetailsLoading] =
    useState(canManage);
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
    const result = StatusResponseSchema.parse(await response.json());
    const next = result.installation_status;
    setStatus(next);
    setInstallation(canManage ? result.installation : undefined);
    setInstallationDetailsLoading(false);
    await queryClient.invalidateQueries({ queryKey: ["vaults"] });
    return next;
  }, [canManage, endpoint, queryClient]);

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
    if (!canManage) {
      setInstallation(undefined);
      return;
    }
    if (initialStatus === "installing" || initialStatus === "upgrading") {
      setBusy(true);
      void pollUntilSettled()
        .catch((caught: unknown) => {
          setInstallationDetailsLoading(false);
          setError(
            caught instanceof Error ? caught.message : t("statusFailed"),
          );
        })
        .finally(() => setBusy(false));
      return;
    }
    void readStatus().catch((caught: unknown) => {
      setInstallationDetailsLoading(false);
      setError(caught instanceof Error ? caught.message : t("statusFailed"));
    });
  }, [canManage, initialStatus, pollUntilSettled, readStatus, t]);

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
      setInstallation(canManage ? result.installation : undefined);
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

  const visibleStatus =
    !canManage && status !== "ready" ? "management_required" : status;
  const statusLabel = t(`status.${visibleStatus}`);
  const hasUnsettledInstallationObservation =
    canManage &&
    !installationDetailsLoading &&
    visibleStatus === "ready" &&
    installation?.lifecycle === "active" &&
    installation.drift?.overall !== "in_sync";
  const statusDescription = hasUnsettledInstallationObservation
    ? t(
        installation?.drift?.overall === "drifted"
          ? "description.readyDrift"
          : "description.readyObservationUnknown",
      )
    : t(`description.${visibleStatus}`);

  return (
    <section
      className="flex w-full flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle/50 px-4 py-4 text-left"
      aria-labelledby={`installation-${vault}-heading`}
      data-testid={`workspace-installation-${vault}`}
      data-status={visibleStatus}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`installation-${vault}-heading`}
              className="type-settings-section text-foreground"
            >
              {t("title", { vault })}
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

      {canManage && (installation || installationDetailsLoading) && (
        <details data-testid="installation-details-disclosure">
          <summary className="cursor-pointer rounded-md border border-border-subtle bg-surface-page/60 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus">
            {t("details.toggle")}
          </summary>
          <div className="mt-3">
            {installation ? (
              <InstallationDetails installation={installation} />
            ) : installationDetailsLoading ? (
              <InstallationDetailsLoading />
            ) : null}
          </div>
        </details>
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
        {(canManage || visibleStatus === "management_required") && (
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
        {onReady &&
          visibleStatus === "ready" &&
          !finishDone.current &&
          !finishing && (
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
      {(canManage || visibleStatus === "management_required") && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="installation-check-status-note"
        >
          {t("checkStatusNote")}
        </p>
      )}
    </section>
  );
}
