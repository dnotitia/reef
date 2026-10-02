"use client";

import { Button } from "@/components/ui/button";
import { InstallationDetailsLoading } from "@/features/workspaceInstallation/components/WorkspaceInstallationLoading";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { formatAbsoluteTime } from "@/lib/relativeTime";
import {
  ControlPlaneInstallationSchema,
  WorkspaceInstallationStatusEnum,
  type ControlPlaneInstallation,
} from "@reef/core";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, type SyntheticEvent } from "react";
import { z } from "zod";

const InstallationResponseSchema = z.object({
  installation_status: WorkspaceInstallationStatusEnum,
  installation: ControlPlaneInstallationSchema.optional(),
});
type InstallationResponse = z.infer<typeof InstallationResponseSchema>;

type LoadState = "idle" | "loading" | "loaded" | "error";

export function WorkspaceInstallationDetails({ vault }: { vault: string }) {
  const t = useTranslations("workspaceInstallation");
  const [installationResponse, setInstallationResponse] = useState<
    InstallationResponse | undefined
  >(undefined);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const loadDetails = useCallback(async () => {
    setLoadState("loading");
    setInstallationResponse(undefined);
    try {
      const response = await apiFetch(
        `/api/vaults/${encodeURIComponent(vault)}/installation`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `GET installation returned ${response.status}`,
        );
      }
      const result = InstallationResponseSchema.parse(await response.json());
      setInstallationResponse(result);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, [vault]);

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && loadState === "idle") {
      void loadDetails();
    }
  }

  const detailText =
    loadState === "loading" ? (
      <InstallationDetailsLoading />
    ) : loadState === "error" ? (
      <div className="flex flex-col items-start gap-2 pt-3">
        <p className="text-sm text-destructive-text" role="alert">
          {t("statusFailed")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadDetails()}
        >
          {t("button.checkStatus")}
        </Button>
      </div>
    ) : installationResponse?.installation ? (
      <InstallationDetailsContent
        installation={installationResponse.installation}
        installationStatus={installationResponse.installation_status}
      />
    ) : loadState === "loaded" ? (
      <p className="pt-3 text-sm text-muted-foreground">
        {t("details.noObservation")}
      </p>
    ) : null;

  return (
    <details
      data-testid="installation-details-disclosure"
      onToggle={handleToggle}
    >
      <summary className="cursor-pointer rounded-md px-1 py-1 text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus">
        {t("details.toggle")}
      </summary>
      <div className="mt-2" data-testid="installation-details-content">
        {detailText}
      </div>
    </details>
  );
}

function InstallationDetailsContent({
  installation,
  installationStatus,
}: {
  installation: ControlPlaneInstallation;
  installationStatus: InstallationResponse["installation_status"];
}) {
  const t = useTranslations("workspaceInstallation.details");
  const locale = useLocale();
  const unknown = t("unknown");
  const drift = installation.drift;
  const overallStatus = drift?.overall ?? "unknown";
  const comparedObservedRelease = drift?.release.observed;
  const snapshotRelease = installation.observed?.release;
  const releaseReferences = [
    installation.desiredRelease,
    installation.currentRelease,
    snapshotRelease,
    drift?.release.desired,
    comparedObservedRelease,
  ];
  const releaseValue = (value: ControlPlaneInstallation["desiredRelease"]) => {
    const version = value?.version;
    const id = value?.id;
    const versionHasDistinctIds =
      version != null &&
      id != null &&
      releaseReferences.some(
        (reference) =>
          reference?.version === version &&
          reference.id != null &&
          reference.id !== id,
      );
    return versionHasDistinctIds
      ? t("releaseVersionWithId", { version, id })
      : (version ?? id ?? unknown);
  };

  const groupedReleaseReferences: Array<{
    labels: string[];
    reference: ControlPlaneInstallation["desiredRelease"];
  }> = [];
  for (const source of [
    {
      label: t("desiredRelease"),
      reference: installation.desiredRelease,
    },
    { label: t("currentRelease"), reference: installation.currentRelease },
    { label: t("observedRelease"), reference: snapshotRelease },
    { label: t("comparedRelease"), reference: comparedObservedRelease },
  ]) {
    const reference = source.reference;
    const duplicate =
      reference?.id != null && reference.version != null
        ? groupedReleaseReferences.find(
            (group) =>
              group.reference?.id === reference.id &&
              group.reference?.version === reference.version,
          )
        : undefined;
    if (duplicate) duplicate.labels.push(source.label);
    else groupedReleaseReferences.push({ labels: [source.label], reference });
  }
  const releaseFields = groupedReleaseReferences.map(
    ({ labels, reference }) => ({ labels, value: releaseValue(reference) }),
  );

  const observedSchema = drift?.schema.observed;
  const observedSchemaFingerprint = installation.observed?.schemaFingerprint;
  const groupedSchemaFields: Array<{
    knownValue: string | undefined;
    labels: string[];
    value: string;
  }> = [];
  for (const source of [
    { label: t("desiredSchema"), value: drift?.schema.expected },
    { label: t("observedSchema"), value: observedSchema },
    ...(observedSchemaFingerprint != null
      ? [
          {
            label: t("observedSchemaFingerprint"),
            value: observedSchemaFingerprint,
          },
        ]
      : []),
  ]) {
    const duplicate =
      source.value != null
        ? groupedSchemaFields.find((field) => field.knownValue === source.value)
        : undefined;
    if (duplicate) duplicate.labels.push(source.label);
    else {
      groupedSchemaFields.push({
        knownValue: source.value ?? undefined,
        labels: [source.label],
        value: source.value ?? unknown,
      });
    }
  }
  const schemaFields = groupedSchemaFields.map(({ labels, value }) => ({
    labels,
    value,
  }));

  const groupedGrantFields: Array<{
    knownValue: number | undefined;
    labels: string[];
    value: string;
  }> = [];
  for (const source of [
    { label: t("desiredGrant"), value: drift?.grant.desiredGeneration },
    { label: t("observedGrant"), value: drift?.grant.observedGeneration },
  ]) {
    const duplicate =
      source.value != null
        ? groupedGrantFields.find((field) => field.knownValue === source.value)
        : undefined;
    if (duplicate) duplicate.labels.push(source.label);
    else {
      groupedGrantFields.push({
        knownValue: source.value ?? undefined,
        labels: [source.label],
        value: source.value?.toString() ?? unknown,
      });
    }
  }
  const grantFields = groupedGrantFields.map(({ labels, value }) => ({
    labels,
    value,
  }));

  return (
    <section
      className="flex flex-col gap-4 pt-2 text-left"
      aria-label={t("heading")}
      data-testid="installation-details"
      data-overall-drift={drift?.overall ?? "unknown"}
    >
      <div className="flex flex-col gap-1">
        {installationStatus === "ready" && overallStatus === "drifted" && (
          <p className="text-sm text-muted-foreground">{t("impact.drifted")}</p>
        )}
        {installationStatus === "ready" && overallStatus === "unknown" && (
          <p className="text-sm text-muted-foreground">{t("impact.unknown")}</p>
        )}
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
        fields={releaseFields}
      />
      <InstallationComparisonGroup
        dimension="schema"
        status={drift?.schema.status}
        fields={schemaFields}
      />
      <InstallationComparisonGroup
        dimension="grant"
        status={drift?.grant.status}
        fields={grantFields}
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
  fields: Array<{ labels: string[]; value: string }>;
}) {
  const t = useTranslations("workspaceInstallation.details");

  return (
    <section
      className="flex flex-col gap-3 border-t border-border-subtle pt-3"
      aria-labelledby={`installation-comparison-${dimension}-heading`}
      data-testid={`installation-comparison-${dimension}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h5
          id={`installation-comparison-${dimension}-heading`}
          className="type-control font-medium text-foreground"
        >
          {t(`dimension.${dimension}`)}
        </h5>
        <span
          className="type-caption text-muted-foreground"
          data-drift-status={status ?? "unknown"}
        >
          {t(`driftStatus.${status ?? "unknown"}`)}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2 sm:gap-y-2">
        {fields.map(({ labels, value }) => (
          <div
            key={labels.join("|")}
            className="min-w-0 sm:row-span-2 sm:grid sm:grid-rows-subgrid"
          >
            <dt className="text-xs text-muted-foreground">
              {labels.join(" · ")}
            </dt>
            <dd className="mt-1 break-all text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
