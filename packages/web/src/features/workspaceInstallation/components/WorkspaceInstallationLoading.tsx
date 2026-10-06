"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

export function InstallationDetailsLoading() {
  return (
    <div
      aria-hidden="true"
      data-testid="installation-details-loading"
      className="flex flex-col gap-4 pt-3"
    >
      <Skeleton className="h-4 w-36" />
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}

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
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-28" />
      </div>
    </section>
  );
}
