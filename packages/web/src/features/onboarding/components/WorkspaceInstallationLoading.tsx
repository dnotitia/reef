"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

/** Reserves the detail panel's shape while a manager's status read is pending. */
export function InstallationDetailsLoading() {
  return (
    <div
      aria-hidden="true"
      data-testid="installation-details-loading"
      className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-page/60 p-3"
    >
      <div className="flex flex-col gap-1">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-32 max-w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Loading shape for the installation section on Workspace settings. */
export function WorkspaceInstallationLoading() {
  const t = useTranslations("settings.routes");

  return (
    <section
      data-testid="workspace-installation-loading"
      aria-labelledby="workspace-installation-loading-heading"
      className="flex flex-col gap-3"
    >
      <h3
        id="workspace-installation-loading-heading"
        className="type-settings-section text-muted-foreground"
      >
        {t("general.installation")}
      </h3>
      <div
        aria-hidden="true"
        className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle/50 px-4 py-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <InstallationDetailsLoading />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </section>
  );
}
