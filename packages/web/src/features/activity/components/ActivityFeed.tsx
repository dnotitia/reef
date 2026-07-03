"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { withVault } from "@/lib/workspaceHref";
import type {
  ActivityDraftSuggestion,
  ActivityStatusChangeSuggestion,
  IssueCreateInput,
  Status,
} from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveActivitySuggestion,
  dismissActivitySuggestion,
  updateActivitySuggestion,
} from "../actions/activitySuggestions.actions";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { useActivityRepo } from "../hooks/useActivityRepo";
import { useLastVisitAt } from "../hooks/useLastVisitAt";
import { useScanActivity } from "../hooks/useScanActivity";
import { UNREAD_INBOX_QUERY_KEY } from "../hooks/useUnreadInboxCount";
import { useActivityStore } from "../stores/useActivityStore";
import { ActivityItemCard } from "./ActivityItemCard";
import { ActivityRefreshButton } from "./ActivityRefreshButton";
import { UnreviewedSummaryCard } from "./UnreviewedSummaryCard";

interface ActivityFeedProps {
  /** Active akb vault name. */
  vault: string;
}

type ApprovingState = Record<string, boolean>;

export function ActivityFeed({ vault }: ActivityFeedProps) {
  const {
    lastVisitAt,
    isLoading: lastVisitLoading,
    updateLastVisitAt,
  } = useLastVisitAt();

  if (lastVisitLoading) {
    return <ActivityFeedSkeleton />;
  }

  return (
    <ActivityFeedContent
      key={vault}
      vault={vault}
      initialLastVisitAt={lastVisitAt ?? undefined}
      updateLastVisitAt={updateLastVisitAt}
    />
  );
}

export function ActivityFeedSkeleton() {
  const common = useTranslations("common");
  // Mirrors the loaded feed's chrome so it does not jump on hydration (REEF-258):
  // the filter-pill row + Refresh control over the scan-target line, then the
  // cards. The pill/refresh/scan rows were missing entirely, so the whole feed
  // shifted down when they appeared; card heights are inherently data-dependent
  // (a draft card with editable fields is far taller than a status-change card),
  // so the placeholders approximate the loaded card height rather than matching
  // it exactly.
  return (
    // The body-level feed skeleton; the route's loading.tsx (and the live feed)
    // own the page header. One screen-reader loading announcement per surface
    // (REEF-281). The decorative chrome carries the original `space-y-4` so the
    // screen-reader sibling does not pick up a stacking margin.
    <div data-testid="activity-feed">
      <output className="sr-only">{common("loading")}</output>
      <div className="space-y-4" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton tone="secondary" className="h-6 w-12 rounded-full" />
            <Skeleton tone="secondary" className="h-6 w-20 rounded-full" />
            <Skeleton tone="secondary" className="h-6 w-28 rounded-full" />
          </div>
          <Skeleton tone="secondary" className="h-7 w-20" />
        </div>
        <Skeleton tone="secondary" className="h-4 w-48" />
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-32 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ActivityFeedContentProps extends ActivityFeedProps {
  initialLastVisitAt?: string;
  updateLastVisitAt: () => Promise<void>;
}

function ActivityFeedContent({
  vault,
  initialLastVisitAt,
  updateLastVisitAt,
}: ActivityFeedContentProps) {
  const {
    items,
    isLoading: feedLoading,
    refreshInbox,
  } = useActivityFeed(vault);
  const {
    repo: scanRepo,
    monitoredRepos,
    setRepo: setScanRepo,
    isLoading: scanRepoLoading,
  } = useActivityRepo(vault);
  const isLoading = feedLoading || scanRepoLoading;
  const projectConfigQuery = useProjectConfig(vault);
  // REEF-313: when the workspace AI-scanning switch is off, hide the manual
  // scan affordance (the on-mount auto-trigger in DashboardShell is gated too)
  // and show a short off-state note instead of the scan target.
  const aiScanningEnabled =
    projectConfigQuery.data?.config.ai_scanning_enabled ?? false;
  const activityTypeFilter = useActivityStore(
    (state) => state.activityTypeFilter,
  );
  const setActivityTypeFilter = useActivityStore(
    (state) => state.setActivityTypeFilter,
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("toasts");
  const ta = useTranslations("activity");
  const nav = useTranslations("nav");
  const statusLabels = useStatusLabels();

  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const [approvingState, setApprovingState] = useState<ApprovingState>({});
  const [scanTick, setScanTick] = useState(0);

  // Manual scan trigger (auto trigger lives in DashboardShell). Both share
  // the AKB activity inbox and the unread inbox invalidation channel.
  const scan = useScanActivity({
    onSuccess: (result) => {
      setScanTick((t) => t + 1);
      if (result.addedDrafts + result.addedStatusChanges > 0) {
        void refreshInbox();
        void queryClient.invalidateQueries({
          queryKey: UNREAD_INBOX_QUERY_KEY,
        });
      }
    },
  });

  useEffect(() => {
    void updateLastVisitAt();
    void queryClient.invalidateQueries({ queryKey: UNREAD_INBOX_QUERY_KEY });
  }, [updateLastVisitAt, queryClient]);

  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [approveError, setApproveError] = useState<string | null>(null);

  const displayItems = useMemo(
    () =>
      removedIds.size === 0
        ? items
        : items.filter((i) => !removedIds.has(i.id)),
    [items, removedIds],
  );

  const newDrafts = initialLastVisitAt
    ? displayItems.filter(
        (i) => i.type === "ai_draft" && i.timestamp > initialLastVisitAt,
      ).length
    : 0;
  const newStatusChanges = initialLastVisitAt
    ? displayItems.filter(
        (i) =>
          i.type === "ai_status_change" && i.timestamp > initialLastVisitAt,
      ).length
    : 0;
  const showSummary =
    !summaryDismissed &&
    initialLastVisitAt !== undefined &&
    (newDrafts > 0 || newStatusChanges > 0);

  const handleDismissSummary = async () => {
    setSummaryDismissed(true);
    await updateLastVisitAt();
  };

  const filteredItems = displayItems.filter((item) => {
    if (activityTypeFilter === "all") return true;
    if (activityTypeFilter === "ai_draft") return item.type === "ai_draft";
    if (activityTypeFilter === "ai_status_change")
      return item.type === "ai_status_change";
    return true;
  });

  const markRemoved = (id: string) =>
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const setApproving = (id: string, value: boolean) =>
    setApprovingState((prev) => {
      const next = { ...prev };
      if (value) next[id] = true;
      else delete next[id];
      return next;
    });

  const handleApproveDraft = async (draft: ActivityDraftSuggestion) => {
    setApproveError(null);
    setApproving(draft.id, true);
    try {
      const prefix = projectConfigQuery.data?.config.project_prefix ?? "REEF";
      const result = await approveActivitySuggestion(draft.id, {
        vault,
        prefix,
      });
      const issueId =
        result.issueId ??
        (result.suggestion.kind === "draft"
          ? result.suggestion.approved_issue_id
          : undefined);

      markRemoved(draft.id);
      void refreshInbox().catch((err) => {
        console.error("Failed to refresh activity inbox:", err);
      });
      void queryClient.invalidateQueries({ queryKey: UNREAD_INBOX_QUERY_KEY });

      toast.success(
        issueId
          ? t("issueCreatedFromDraft", { id: issueId })
          : t("draftApproved"),
      );
      if (issueId) router.push(withVault(vault, `/issues/${issueId}`));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("approveDraftError");
      console.error("Failed to approve draft:", err);
      setApproveError(message);
      toast.error(message);
    } finally {
      setApproving(draft.id, false);
    }
  };

  const handleSaveDraftEdits = async (
    draftId: string,
    edits: IssueCreateInput,
  ) => {
    await updateActivitySuggestion(draftId, vault, { create: edits });
    await refreshInbox();
  };

  const handleDismissDraft = async (draftId: string) => {
    await dismissActivitySuggestion(draftId, vault);
    markRemoved(draftId);
    await refreshInbox();
    void queryClient.invalidateQueries({ queryKey: UNREAD_INBOX_QUERY_KEY });
  };

  const handleApproveStatusChange = async (
    statusChange: ActivityStatusChangeSuggestion,
  ) => {
    setApproveError(null);
    setApproving(statusChange.id, true);
    try {
      await approveActivitySuggestion(statusChange.id, { vault });
      markRemoved(statusChange.id);
      await refreshInbox();
      void queryClient.invalidateQueries({ queryKey: UNREAD_INBOX_QUERY_KEY });
      // The issue's status just changed on akb. The detail cache otherwise
      // stays fresh for ~30s and the user would see a stale status if they
      // open the issue right after approving. Invalidate this vault's list and
      // relation projections too so the board/list reflects the new status and
      // its blocker state — scoped to `vault`, not every workspace (REEF-098).
      const issueId = statusChange.proposal.update.issue_id;
      const toStatus = statusChange.proposal.update.patch.status;
      void queryClient.invalidateQueries({
        queryKey: ["issues", "detail", vault, issueId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
      void queryClient.invalidateQueries({
        queryKey: ["issues", "relations", vault],
      });

      toast.success(
        t("issueMoved", {
          id: issueId,
          status: toStatus
            ? statusLabels[toStatus]
            : t("issueMovedFallbackStatus"),
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("statusChangeError");
      console.error("Failed to approve status change:", err);
      setApproveError(message);
      toast.error(message);
    } finally {
      setApproving(statusChange.id, false);
    }
  };

  const handleSaveStatusChange = async (
    statusChangeId: string,
    toStatus: Status,
  ) => {
    const item = items.find(
      (i) => i.id === statusChangeId && i.type === "ai_status_change",
    );
    if (!item || item.type !== "ai_status_change") return;
    await updateActivitySuggestion(statusChangeId, vault, {
      update: {
        ...item.statusChange.proposal.update,
        patch: { ...item.statusChange.proposal.update.patch, status: toStatus },
      },
    });
    await refreshInbox();
  };

  const handleDismissStatusChange = async (statusChangeId: string) => {
    await dismissActivitySuggestion(statusChangeId, vault);
    markRemoved(statusChangeId);
    await refreshInbox();
    void queryClient.invalidateQueries({ queryKey: UNREAD_INBOX_QUERY_KEY });
  };

  if (isLoading) {
    return <ActivityFeedSkeleton />;
  }

  return (
    <div data-testid="activity-feed" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
          <legend className="sr-only">{ta("filterActivity")}</legend>
          {(
            [
              { value: "all", label: ta("filterAll") },
              { value: "ai_draft", label: ta("filterAiDrafts") },
              { value: "ai_status_change", label: ta("filterStatusChanges") },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setActivityTypeFilter(value)}
              className={[
                "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150",
                activityTypeFilter === value
                  ? "bg-foreground text-background"
                  : "bg-secondary text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {aiScanningEnabled && (
          <ActivityRefreshButton
            repo={scanRepo}
            onRefresh={() =>
              scan.mutate({ vault, repo: scanRepo, source: "manual" })
            }
            isScanning={scan.isPending}
            scanTick={scanTick}
          />
        )}
      </div>

      {!aiScanningEnabled ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="activity-scanning-off"
        >
          {ta.rich("scanningOff", {
            settingsLink: () => (
              <Link
                href={withVault(vault, "/settings")}
                className="text-brand underline"
              >
                {nav("settings")}
              </Link>
            ),
          })}
        </p>
      ) : monitoredRepos.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="activity-scan-target-empty"
        >
          {ta.rich("addMonitoredRepo", {
            settingsLink: () => (
              <Link
                href={withVault(vault, "/settings")}
                className="text-brand underline"
              >
                {nav("settings")}
              </Link>
            ),
          })}
        </p>
      ) : (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="activity-scan-target"
        >
          <span>{ta("scanning")}</span>
          {monitoredRepos.length === 1 ? (
            <span
              className="font-mono text-foreground/90"
              data-testid="activity-scan-target-single"
            >
              {monitoredRepos[0]}
            </span>
          ) : (
            <select
              aria-label={ta("monitoredRepoToScan")}
              data-testid="activity-scan-target-select"
              value={scanRepo}
              onChange={(e) => void setScanRepo(e.target.value)}
              className="rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {monitoredRepos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {approveError && (
        <div
          role="alert"
          data-testid="activity-approve-error"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
        >
          {approveError}
        </div>
      )}

      {showSummary && (
        <UnreviewedSummaryCard
          draftCount={newDrafts}
          statusChangeCount={newStatusChanges}
          onDismiss={handleDismissSummary}
        />
      )}

      {filteredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {ta("emptyFeed")}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredItems.map((item) => (
            <li key={item.id}>
              <ActivityItemCard
                item={item}
                onApproveDraft={handleApproveDraft}
                onDismissDraft={handleDismissDraft}
                onSaveDraftEdits={handleSaveDraftEdits}
                onApproveStatusChange={handleApproveStatusChange}
                onDismissStatusChange={handleDismissStatusChange}
                onSaveStatusChange={handleSaveStatusChange}
                isApproving={approvingState[item.id] ?? false}
                vault={vault}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
