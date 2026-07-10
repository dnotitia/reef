"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { DevelopmentTargetCard } from "@/features/settings/components/DevelopmentTargetCard";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useDevelopmentTargets } from "@/features/settings/hooks/useDevelopmentTargets";
import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function AgentExecutionSettingsPage() {
  const t = useTranslations("settings.routes.execution");
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { canManageExecution, isResolving } = useWorkspaceAccess(vault);
  const query = useDevelopmentTargets(vault);
  const resolving = vaultLoading || isResolving;

  return (
    <SettingsGroup
      title={t("title")}
      description={t("description")}
      access={
        resolving ? undefined : canManageExecution ? "editable" : "view-only"
      }
      scopeName={vaultLoading || !vault ? undefined : vault}
      testId="settings-group-agent-execution"
    >
      {resolving || query.isPending ? (
        <div className="space-y-4" aria-label={t("loading")}>
          <Skeleton className="h-52 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t("loadFailed")}
        </div>
      ) : query.data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 px-6 py-10 text-center">
          <h3 className="font-display text-sm font-semibold">
            {t("emptyTitle")}
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted-foreground">
            {t("emptyDescription")}
          </p>
          <Link
            className="mt-4 inline-flex text-xs font-medium text-brand hover:underline"
            href={withVault(vault, "/settings/workspace")}
          >
            {t("openMonitoredRepos")}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {query.data.items.map((item) => (
            <DevelopmentTargetCard
              key={item.repo.github_id}
              vault={vault}
              item={item}
              catalog={query.data.catalog}
              canEdit={canManageExecution}
            />
          ))}
        </div>
      )}
    </SettingsGroup>
  );
}
