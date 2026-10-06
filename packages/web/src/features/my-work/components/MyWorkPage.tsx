"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useMyWorkData } from "@/features/my-work/hooks/useMyWorkData";
import { MyWorkSkeleton } from "@/features/my-work/components/MyWorkPageSkeleton";
import {
  type GroupMode,
  MyWorkQueue,
} from "@/features/my-work/components/MyWorkQueue";
import { MyWorkSummary } from "@/features/my-work/components/MyWorkSummary";
import { buildMyWork } from "@/features/my-work/lib/myWork";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

function Shell({
  description,
  children,
}: {
  /** The header subtitle here is the *personal* scope (`@login · N open`), not
   *  the active workspace name the other PageHeader subtitles carry. My Work is
   *  a per-user view, so this divergence is intentional — it is the caller
   *  that does not pass the vault. It is also the one subtitle that mixes an
   *  identifier with translatable prose (the `open` count label), so the
   *  full-summary state passes a node that marks `@login` translate="no"
   *  and leaves the count translatable (REEF-260). */
  description?: ReactNode;
  children: ReactNode;
}) {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full min-w-0 flex-col">
      <PageHeader title={nav("myWork")} description={description} />
      <PageBody width="wide" className="flex flex-col gap-6">
        {children}
      </PageBody>
    </div>
  );
}

/**
 * `/my-work` — the personal view. The server scopes assignments to the signed-in
 * actor across every ready workspace; an independent workspace filter only
 * narrows the visible queue. Summary and empty-state counts remain account-wide.
 */
export function MyWorkPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const workQuery = useMyWorkData();
  const login = workQuery.login;

  // Captured once so the deadline classification is stable across re-renders
  // (and so memoised rows are not invalidated every render).
  const [now] = useState(() => Date.now());
  const issues = useMemo(() => workQuery.data?.issues ?? [], [workQuery.data]);
  const myWork = useMemo(() => {
    return buildMyWork(issues, workQuery.workspaceContexts, { now });
  }, [issues, now, workQuery.workspaceContexts]);

  const searchParams = useSearchParams();
  const router = useRouter();
  const mode: GroupMode =
    searchParams.get("group") === "status" ? "status" : "priority";
  const selectedWorkspaceValue = searchParams.get("workspace");
  const workspaces = workQuery.data?.workspaces ?? [];
  const selectedWorkspace = workspaces.some(
    ({ workspace }) => workspace === selectedWorkspaceValue,
  )
    ? selectedWorkspaceValue
    : null;
  const visibleItems = useMemo(
    () =>
      selectedWorkspace
        ? myWork.items.filter((item) => item.workspace === selectedWorkspace)
        : myWork.items,
    [myWork.items, selectedWorkspace],
  );
  const setMode = useCallback(
    (next: GroupMode) => {
      const params = new URLSearchParams(searchParams);
      if (next === "priority") params.delete("group");
      else params.set("group", next);
      const qs = params.toString();
      router.replace(withVault(vault, qs ? `/my-work?${qs}` : "/my-work"), {
        scroll: false,
      });
    },
    [router, searchParams, vault],
  );
  const setWorkspace = useCallback(
    (workspace: string | null) => {
      const params = new URLSearchParams(searchParams);
      if (workspace) params.set("workspace", workspace);
      else params.delete("workspace");
      const qs = params.toString();
      router.replace(withVault(vault, qs ? `/my-work?${qs}` : "/my-work"), {
        scroll: false,
      });
    },
    [router, searchParams, vault],
  );

  // The planning catalog is an independent query, so the current sprint can be
  // known before the issues finish loading. Thread it into the in-flight
  // skeleton so its tile count matches the loaded summary (sprint → 4 tiles, no
  // sprint → 3) instead of reflowing on hydration (REEF-258).
  const hasSprint = myWork.summary.sprints.length > 0;

  const t = useTranslations("myWork");
  const c = useTranslations("common");
  const nav = useTranslations("nav");

  if (vaultLoading || workQuery.identityPending) {
    return (
      <Shell>
        <MyWorkSkeleton hasSprint={hasSprint} />
      </Shell>
    );
  }

  if (!vault) {
    // The no-vault gate is the app-level "no workspace" state, shared across all
    // five surfaces (REEF-259), so it bypasses `Shell` (which wraps children in a
    // PageBody) and lets the shared notice own its own centered layout beneath
    // the header.
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={nav("myWork")} />
        <EmptyWorkspaceNotice />
      </div>
    );
  }

  if (!login) {
    return (
      <Shell>
        <EmptyState
          data-testid="my-work-no-session"
          title={t("noSessionTitle")}
          description={t("noSessionDescription")}
        />
      </Shell>
    );
  }

  if (workQuery.isPending) {
    return (
      <Shell>
        <MyWorkSkeleton hasSprint={hasSprint} />
      </Shell>
    );
  }

  if (workQuery.isError) {
    return (
      <Shell>
        <div
          data-testid="my-work-error"
          className="flex flex-col items-start gap-2"
        >
          <p className="text-sm text-destructive-text">
            {workQuery.error instanceof Error
              ? workQuery.error.message
              : t("loadError")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void workQuery.refetch()}
          >
            {c("retry")}
          </Button>
        </div>
      </Shell>
    );
  }

  if (
    issues.length === 0 &&
    !workspaces.some((workspace) => workspace.assigned_issue_count > 0)
  ) {
    return (
      <Shell>
        <EmptyState
          data-testid="my-work-empty"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </Shell>
    );
  }

  if (issues.length === 0) {
    return (
      <Shell description={`@${login}`}>
        <EmptyState
          data-testid="my-work-caught-up"
          title={t("caughtUpTitle")}
          description={t("caughtUpDescription")}
        />
      </Shell>
    );
  }

  return (
    <Shell
      description={
        <>
          {/* The login is an identifier; the count label is prose, so it
              stays translatable (REEF-260). */}
          <span translate="no">@{login}</span>
          {t("openSummary", { count: myWork.summary.open })}
        </>
      }
    >
      <div data-testid="my-work-page" className="flex flex-col gap-6">
        <MyWorkSummary summary={myWork.summary} />
        <MyWorkQueue
          items={visibleItems}
          mode={mode}
          onModeChange={setMode}
          workspaces={workspaces.map(({ workspace }) => workspace)}
          selectedWorkspace={selectedWorkspace}
          onWorkspaceChange={setWorkspace}
        />
      </div>
    </Shell>
  );
}
