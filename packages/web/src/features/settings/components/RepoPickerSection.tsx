"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useHasGithubToken } from "@/features/settings/hooks/useHasGithubToken";
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
import { useCallback, useMemo, useState } from "react";
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

  // Token gate (REEF-159): without a configured token `useRepos` is disabled,
  // so its query sits in a permanent `pending` fetchStatus. Drive the selector's
  // loading/error from token state directly — keying loading off `isPending`
  // alone would pin the picker to a forever-skeleton, and treating "no token"
  // as an error surfaces the same "connect GitHub first" hint without ever
  // issuing the 401-bound request.
  const { hasToken, isLoading: tokenLoading } = useHasGithubToken();
  const reposQuery = useRepos();
  const availableRepos = useMemo(
    () => reposQuery.data ?? [],
    [reposQuery.data],
  );
  const reposFetchLoading = tokenLoading || (hasToken && reposQuery.isPending);
  const reposFetchError = !hasToken || (reposQuery.isError && !reposQuery.data);

  const configQuery = useProjectConfig(activeVault);
  const updateConfig = useUpdateProjectConfig(activeVault);

  const serverMonitoredList = useMemo<readonly MonitoredRepo[]>(
    () => configQuery.data?.config.monitored_repos ?? [],
    [configQuery.data],
  );

  const serverMonitoredKey = useMemo(
    () =>
      serverMonitoredList
        .map((r) => `${r.owner}/${r.name}`)
        .sort()
        .join("\n"),
    [serverMonitoredList],
  );

  return (
    <RepoPickerSectionContent
      key={`${activeVault || "no-vault"}:${serverMonitoredKey}`}
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
  const [selectedMonitoredRepos, setSelectedMonitoredRepos] = useState<
    Set<string>
  >(() => new Set(serverMonitoredList.map((r) => `${r.owner}/${r.name}`)));
  const [saveMessage, setSaveMessage] = useState("");

  const handleMonitoredRepoToggle = useCallback(
    async (repo: string) => {
      if (!activeVault) {
        setSaveMessage("Select a workspace first.");
        return;
      }
      if (updateConfig.isPending) return;
      // Without a loaded server config there is no trustworthy baseline: the
      // PATCH replaces the whole monitored_repos list, so building it from an
      // empty `serverMonitoredList` (config GET failed) would wipe every
      // previously saved repo. Refuse the mutation until the config loads.
      if (!configDataLoaded) {
        setSaveMessage("Couldn't load workspace config — try again.");
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

      const payload = buildMonitoredReposPayload(
        serverMonitoredList,
        next,
        availableRepos,
      );

      try {
        await updateConfig.mutateAsync({
          patch: { monitored_repos: payload },
        });
        setSaveMessage("Monitored repositories saved.");
        onSaved?.();
      } catch {
        setSaveMessage("Failed to save monitored repositories.");
      }
    },
    [
      activeVault,
      availableRepos,
      configDataLoaded,
      onSaved,
      selectedMonitoredRepos,
      serverMonitoredList,
      updateConfig,
    ],
  );

  // Gate edits on a loaded server config (`configQuery.data`) — not just
  // isPending — so a failed config load does not leave the selector enabled with
  // an empty baseline (which a replace-all PATCH would persist as data loss).
  const monitoredDisabled =
    !activeVault || !configDataLoaded || updateConfig.isPending;

  return (
    <div className="flex flex-col gap-4" data-testid="repo-picker-section">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground/90">
          Monitored Code Repositories
        </p>
        <p className="text-xs text-muted-foreground">
          GitHub repos reef watches for activity (PRs, commits). Stored in the
          active workspace's <code>monitored_repos</code> table — shared with
          your whole team.
        </p>

        {canEdit ? (
          <MonitoredRepoSelector
            availableRepos={availableRepos}
            selectedRepos={selectedMonitoredRepos}
            onToggle={(repo) => void handleMonitoredRepoToggle(repo)}
            isLoading={reposFetchLoading || !!(activeVault && configPending)}
            isError={reposFetchError && !reposFetchLoading}
            disabled={monitoredDisabled}
            errorMessage="Connect GitHub in the Preferences tab first."
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
            No repositories are being monitored.
          </p>
        )}

        {configError && activeVault && (
          <p
            role="alert"
            className="text-xs text-destructive"
            data-testid="repo-picker-load-error"
          >
            Couldn't load workspace config: {configError.message}
          </p>
        )}
      </div>

      {saveMessage && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="repo-picker-save-message"
        >
          {saveMessage}
        </p>
      )}
    </div>
  );
}
