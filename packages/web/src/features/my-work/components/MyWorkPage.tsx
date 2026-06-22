"use client";

import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { MyWorkSkeleton } from "@/features/my-work/components/MyWorkPageSkeleton";
import {
  type GroupMode,
  MyWorkQueue,
} from "@/features/my-work/components/MyWorkQueue";
import { MyWorkSummary } from "@/features/my-work/components/MyWorkSummary";
import {
  buildMyWork,
  filterAssignedTo,
  selectCurrentSprint,
} from "@/features/my-work/lib/myWork";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

function Shell({
  description,
  children,
}: {
  /** The header subtitle here is the *personal* scope (`@login · N open`), not
   *  the active workspace name the other PageHeader subtitles carry. My Work is
   *  a per-user view, so this divergence is intentional — it is the one caller
   *  that does not pass the vault. It is also the one subtitle that mixes an
   *  identifier with translatable prose (the `open` count label), so the
   *  full-summary state passes a node that marks only `@login` translate="no"
   *  and leaves the count translatable (REEF-260). */
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="My Work" description={description} />
      <PageBody width="wide" className="flex flex-col gap-6">
        {children}
      </PageBody>
    </div>
  );
}

function CenteredNotice({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-dashed border-border-subtle bg-surface-subtle px-6 py-16 text-center"
    >
      {children}
    </div>
  );
}

/**
 * `/my-work` — the personal view (REEF-181). Auto-scoped to the signed-in user
 * (`assigned_to`) with no scope picker (AC1); a focus-sorted queue under a light
 * summary strip, with clean empty / no-session states (AC7). The sidebar entry
 * and its attention badge are REEF-204's surface, not this page.
 */
export function MyWorkPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { data: me, isPending: meLoading } = useCurrentUser();
  const login = me?.username?.trim() || null;

  // Scope every fetch to the signed-in user. The vault is blanked until we have
  // a login so a logged-out visit does not fan out a whole-vault query.
  const scopedVault = login ? vault : "";
  const query = useMemo(
    () => (login ? buildIssueQuery({ assignee: login }) : undefined),
    [login],
  );
  const issuesQuery = useIssueList(scopedVault, query);
  const relationsQuery = useIssueRelations(scopedVault);
  const planningQuery = usePlanningCatalog(scopedVault);

  // Captured once so the deadline classification is stable across re-renders
  // (and so memoised rows are not invalidated every render).
  const [now] = useState(() => Date.now());
  // The server `assigned_to` filter is a substring match, so exact-scope the
  // fetched rows to the full login before anything treats them as "mine"
  // (REEF-181 autoreview).
  const issues = useMemo(
    () => filterAssignedTo(issuesQuery.data ?? [], login ?? ""),
    [issuesQuery.data, login],
  );
  const currentSprint = useMemo(
    () => selectCurrentSprint(planningQuery.data?.sprints ?? []),
    [planningQuery.data],
  );
  const myWork = useMemo(() => {
    // Blocked state resolves against the whole-vault relation projection, does not
    // the assignee-scoped `issues` list — a cross-assignee dependency missing
    // from that narrow set would otherwise read as an unresolved blocker. Empty
    // until the projection loads; buildMyWork skips blocked while it is.
    const graph = relationsQuery.data ?? [];
    return buildMyWork(issues, graph, { now, currentSprint });
  }, [issues, relationsQuery.data, now, currentSprint]);

  const searchParams = useSearchParams();
  const router = useRouter();
  const mode: GroupMode =
    searchParams.get("group") === "status" ? "status" : "priority";
  const setMode = useCallback(
    (next: GroupMode) => {
      const params = new URLSearchParams(searchParams);
      if (next === "priority") params.delete("group");
      else params.set("group", next);
      const qs = params.toString();
      router.replace(qs ? `/my-work?${qs}` : "/my-work", { scroll: false });
    },
    [router, searchParams],
  );

  if (vaultLoading || meLoading) {
    return (
      <Shell>
        <MyWorkSkeleton />
      </Shell>
    );
  }

  if (!vault) {
    return (
      <Shell>
        <CenteredNotice testId="my-work-no-vault">
          <p className="text-sm text-muted-foreground">
            Pick a workspace in{" "}
            <a
              href="/settings"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Settings
            </a>{" "}
            to see your work.
          </p>
        </CenteredNotice>
      </Shell>
    );
  }

  if (!login) {
    return (
      <Shell>
        <CenteredNotice testId="my-work-no-session">
          <p className="text-sm font-medium text-foreground">
            We couldn't find your session
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to see the work assigned to you.
          </p>
        </CenteredNotice>
      </Shell>
    );
  }

  if (issuesQuery.isPending) {
    return (
      <Shell>
        <MyWorkSkeleton />
      </Shell>
    );
  }

  if (issuesQuery.isError) {
    return (
      <Shell>
        <div
          data-testid="my-work-error"
          className="flex flex-col items-start gap-2"
        >
          <p className="text-sm text-destructive">
            {issuesQuery.error instanceof Error
              ? issuesQuery.error.message
              : "Failed to load your work."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void issuesQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </Shell>
    );
  }

  if (issues.length === 0) {
    return (
      <Shell>
        <CenteredNotice testId="my-work-empty">
          <p className="text-sm font-medium text-foreground">
            Nothing is assigned to you yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Issues assigned to you show up here, prioritized for what to do
            next.
          </p>
          <Link
            href="/issues?view=board"
            className="mt-3 inline-block text-[13px] font-medium text-brand hover:underline"
          >
            Go to the board →
          </Link>
        </CenteredNotice>
      </Shell>
    );
  }

  if (myWork.items.length === 0) {
    return (
      <Shell description={`@${login}`}>
        <CenteredNotice testId="my-work-caught-up">
          <p className="text-sm font-medium text-foreground">
            You're all caught up
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            No open work is assigned to you right now.
          </p>
          <Link
            href="/issues?view=board"
            className="mt-3 inline-block text-[13px] font-medium text-brand hover:underline"
          >
            Go to the board →
          </Link>
        </CenteredNotice>
      </Shell>
    );
  }

  return (
    <Shell
      description={
        <>
          {/* Only the login is an identifier; the count label is prose, so it
              stays translatable (REEF-260). */}
          <span translate="no">@{login}</span>
          {` · ${myWork.summary.open} open`}
        </>
      }
    >
      <div data-testid="my-work-page" className="flex flex-col gap-6">
        <MyWorkSummary summary={myWork.summary} />
        <MyWorkQueue items={myWork.items} mode={mode} onModeChange={setMode} />
      </div>
    </Shell>
  );
}
