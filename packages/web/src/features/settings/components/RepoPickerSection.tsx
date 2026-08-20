"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useGithubAppAvailable } from "@/features/settings/hooks/useGithubAppAvailable";
import {
  type ConfigMutation,
  useProjectConfig,
  useUpdateProjectConfig,
} from "@/features/settings/hooks/useProjectConfig";
import {
  type RepoListItem,
  useRepos,
} from "@/features/settings/hooks/useRepos";
import type { MonitoredRepo } from "@reef/core";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MonitoredRepoSelector,
  buildMonitoredReposPayload,
} from "./MonitoredRepoSelector";

interface RepoPickerSectionProps {
  /** Called after settings are saved so parent can refresh displayed values. */
  onSaved?: () => void;
  /**
   * Gate the team-shared monitored-repos editing for non-admin viewers
   * (REEF-020). Read viewers see the saved repos as plain chips.
   */
  canEdit?: boolean;
}

/**
 * Monitored-repos picker for the active workspace.
 *
 * Monitored repos are GitHub repos (addressed by stable numeric `github_id`)
 * stored in the active vault's `monitored_repos` table and shared across the
 * team. The active-vault pointer that scopes them is picked in
 * `ActiveWorkspaceSection`, above the shared workspace settings (REEF-150);
 * here it is read via `useActiveVault`.
 */
export function RepoPickerSection({
  onSaved,
  canEdit = true,
}: RepoPickerSectionProps) {
  const { vault: activeVault, isLoading: activeVaultLoading } =
    useActiveVault();

  // Deployment credential gate: without a configured GitHub App, `useRepos` is
  // disabled and the selector shows a deployment-state hint instead of a
  // forever skeleton or a user-token prompt.
  const { isAvailable: appAvailable, isLoading: appLoading } =
    useGithubAppAvailable();
  const canListRepos = appAvailable;
  const credentialLoading = appLoading;
  const reposQuery = useRepos();
  const availableRepos = useMemo(
    () => reposQuery.data ?? [],
    [reposQuery.data],
  );
  const reposFetchLoading =
    credentialLoading || (canListRepos && reposQuery.isPending);
  const reposFetchError =
    !canListRepos || (reposQuery.isError && !reposQuery.data);

  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);

  const serverMonitoredList = useMemo<readonly MonitoredRepo[]>(
    () => configQuery.data?.config.monitored_repos ?? [],
    [configQuery.data],
  );

  return (
    <RepoPickerSectionContent
      key={activeVault || "no-vault"}
      activeVault={activeVault}
      activeVaultLoading={activeVaultLoading}
      availableRepos={availableRepos}
      canEdit={canEdit}
      configDataLoaded={!!configQuery.data}
      configError={configQuery.error}
      configPending={configQuery.isPending}
      onSaved={onSaved}
      reposFetchError={reposFetchError}
      reposFetchLoading={reposFetchLoading}
      serverMonitoredList={serverMonitoredList}
      updateConfig={updateConfig}
    />
  );
}

interface RepoPickerSectionContentProps {
  activeVault: string;
  activeVaultLoading: boolean;
  availableRepos: readonly RepoListItem[];
  canEdit: boolean;
  configDataLoaded: boolean;
  configError: Error | null;
  configPending: boolean;
  onSaved?: () => void;
  reposFetchError: boolean;
  reposFetchLoading: boolean;
  serverMonitoredList: readonly MonitoredRepo[];
  updateConfig: ConfigMutation;
}

function RepoPickerSectionContent({
  activeVault,
  activeVaultLoading,
  availableRepos,
  canEdit,
  configDataLoaded,
  configError,
  configPending,
  onSaved,
  reposFetchError,
  reposFetchLoading,
  serverMonitoredList,
  updateConfig,
}: RepoPickerSectionContentProps) {
  const t = useTranslations("settings.config");
  const [selectedMonitoredRepos, setSelectedMonitoredRepos] = useState<
    Set<string>
  >(() => new Set(serverMonitoredList.map((r) => `${r.owner}/${r.name}`)));
  const [saveMessage, setSaveMessage] = useState("");
  const [saveMessageKind, setSaveMessageKind] = useState<
    "success" | "error" | ""
  >("");

  // Keep the selector's local selection in sync with the server projection
  // without remounting its Popover. Remounting after a successful PATCH would
  // disconnect the trigger before the primitive's selection-focus restoration
  // frame runs (REEF-536).
  useEffect(() => {
    if (updateConfig.isPending) return;
    setSelectedMonitoredRepos(
      new Set(serverMonitoredList.map((r) => `${r.owner}/${r.name}`)),
    );
  }, [updateConfig.isPending, serverMonitoredList]);

  const handleMonitoredRepoToggle = useCallback(
    async (repo: string) => {
      if (!activeVault) {
        setSaveMessage(t("repos.selectWorkspaceFirst"));
        setSaveMessageKind("error");
        return;
      }
      if (updateConfig.isPending) return;
      // Without a loaded server config there is no trustworthy baseline: the
      // PATCH replaces the whole monitored_repos list, so building it from an
      // empty `serverMonitoredList` (config GET failed) would wipe every
      // previously saved repo. Refuse the mutation until the config loads.
      if (!configDataLoaded) {
        setSaveMessage(t("repos.configLoadError"));
        setSaveMessageKind("error");
        return;
      }

      const next = new Set(selectedMonitoredRepos);
      if (next.has(repo)) {
        next.delete(repo);
      } else {
        next.add(repo);
      }
      setSelectedMonitoredRepos(next);
      setSaveMessage("");
      setSaveMessageKind("");

      try {
        const payload = buildMonitoredReposPayload(
          serverMonitoredList,
          next,
          availableRepos,
        );
        await updateConfig.mutateAsync({
          patch: { monitored_repos: payload },
        });
        setSaveMessage(t("repos.saveSuccess"));
        setSaveMessageKind("success");
        onSaved?.();
      } catch {
        setSaveMessage(t("repos.saveError"));
        setSaveMessageKind("error");
      }
    },
    [
      activeVault,
      availableRepos,
      configDataLoaded,
      onSaved,
      selectedMonitoredRepos,
      serverMonitoredList,
      t,
      updateConfig,
    ],
  );

  // Gate edits on a loaded server config (`configQuery.data`) — not just
  // isPending — so a failed config load does not leave the selector enabled with
  // an empty baseline (which a replace-all PATCH would persist as data loss).
  const monitoredDisabled = !activeVault || !configDataLoaded;

  return (
    <div className="flex flex-col gap-4" data-testid="repo-picker-section">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          {t("repos.heading")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.rich("repos.description", {
            // `monitored_repos` is a vault table name (code identifier), verbatim.
            code: () => <code>monitored_repos</code>, // i18n-exempt
          })}
        </p>

        {canEdit ? (
          <MonitoredRepoSelector
            availableRepos={availableRepos}
            selectedRepos={selectedMonitoredRepos}
            onToggle={(repo) => void handleMonitoredRepoToggle(repo)}
            isLoading={reposFetchLoading || !!(activeVault && configPending)}
            isError={reposFetchError && !reposFetchLoading}
            disabled={monitoredDisabled}
            busy={updateConfig.isPending}
            errorMessage={t("repos.githubAppUnavailable")}
          />
        ) : activeVaultLoading || (activeVault && configPending) ? (
          // Read path: don't conflate a still-loading workspace/config with
          // an empty one — cover both Dexie vault hydration (activeVault is "" +
          // loading) and the config fetch, mirroring the editable selector's
          // loading state (REEF-020).
          <Skeleton
            className="h-9 w-64"
            data-testid="monitored-repos-readonly-loading"
          />
        ) : !activeVault || configError ? null : serverMonitoredList.length >
          0 ? (
          <div
            className="flex flex-wrap gap-1"
            data-testid="monitored-repos-readonly"
          >
            {serverMonitoredList.map((repo) => (
              <span
                key={repo.github_id}
                className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground"
              >
                {repo.owner}/{repo.name}
              </span>
            ))}
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="monitored-repos-readonly-empty"
          >
            {t("repos.empty")}
          </p>
        )}

        {configError && activeVault && (
          <p
            role="alert"
            className="text-xs text-destructive-text"
            data-testid="repo-picker-load-error"
          >
            {t("loadError")} {configError.message}
          </p>
        )}
      </div>

      <p
        role={saveMessageKind === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
        className="min-h-5 text-sm text-muted-foreground"
        data-testid="repo-picker-save-message"
      >
        {updateConfig.isPending ? t("saving") : saveMessage}
      </p>
    </div>
  );
}
