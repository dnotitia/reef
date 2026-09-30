"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { IssueDetailAuthPendingSkeleton } from "@/features/issues/components/detail/IssueDetailAuthPendingSkeleton";
import { useIssueDetailEntryHandoff } from "@/features/issues/components/detail/IssueDetailEntryHandoff";
import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { useHydrated } from "@/lib/useHydrated";
import { withVault } from "@/lib/workspaceHref";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useState } from "react";

interface IssuePageProps {
  params: Promise<{ id: string; vault: string }>;
}

/**
 * Base route for /workspace/[vault]/issues/[id] — reached on hard navigation
 * (refresh, paste-into-address-bar, deep link from Slack/email).
 *
 * Soft navigation from the issues list (any view) is intercepted
 * by the sibling `@modal/(.)issues/[id]/page.tsx` instead, so this file just
 * runs when the URL was hit cold.
 *
 * UX: the IssuesWorkspace fills the layout slot as a backdrop and the
 * IssueDetailSheet slide-over sits on top. When a cold hit has no `?view=`, the
 * workspace defaults to the Board view; any supplied view/filter/sort query is
 * carried back to the entry list. A cold hit starts a depth-0 drill trail
 * (REEF-270), so exiting pushes the user to that vault-scoped list — we don't
 * rely on history.back() here because the tab may have started directly at
 * this URL with no prior entry. When a cold-open sheet drills into a related
 * issue, this base route remains the session owner and updates the same sheet
 * in place; the intercepting slot yields so its wayfinding frame stays mounted.
 */
export default function IssuePage({ params }: IssuePageProps) {
  const { id, vault } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasDrilledInSession = useIssueNavStack(
    (state) => state.hasDrilledInSession,
  );
  const currentId = useIssueNavStack((state) => state.currentId);
  const entryRoute = useIssueNavStack((state) => state.entryRoute);
  const sheetIssueId = hasDrilledInSession && currentId ? currentId : id;
  const entryViewPath = searchParams.toString()
    ? `/issues?${searchParams.toString()}`
    : "/issues";

  // The IssueDetailSheet is a modal Radix Dialog rendered open. On this cold-hit
  // route it shares the initial SSR/hydration pass with the IssuesWorkspace
  // backdrop, and Radix's modal `aria-hidden` management (the aria-hidden
  // package's hideOthers) stamps aria-hidden/data-aria-hidden onto the backdrop
  // DOM mid-hydration — attributes the server HTML does not had, so React reports a
  // hydration mismatch across the whole backdrop subtree. Deferring the sheet to
  // a post-mount render lets the workspace hydrate cleanly first; the slide-over
  // then mounts afterward. The static detail shell stays until the portaled
  // content is ready, so hydration and portal mounting cannot expose the board.
  // The intercepting soft-nav route doesn't need this — its backdrop hydrated
  // before the sheet ever opens.
  const mounted = useHydrated();
  const [sheetReady, setSheetReady] = useState(false);
  const completeGuardHandoff = useIssueDetailEntryHandoff();
  const handleSheetReady = useCallback(() => {
    setSheetReady(true);
    completeGuardHandoff?.();
  }, [completeGuardHandoff]);

  return (
    <>
      {mounted || hasDrilledInSession ? (
        <Suspense fallback={<IssuesWorkspaceSkeleton />}>
          <IssuesWorkspace />
        </Suspense>
      ) : null}
      {entryRoute !== "modal" &&
      !hasDrilledInSession &&
      !sheetReady &&
      !completeGuardHandoff ? (
        <IssueDetailAuthPendingSkeleton
          issueId={id}
          searchParams={searchParams.toString()}
          showWorkspaceSkeleton={!mounted}
        />
      ) : null}
      {mounted && entryRoute !== "modal" && (
        <IssueDetailSheet
          entryRoute="base"
          issueId={sheetIssueId}
          onReady={handleSheetReady}
          disableOpenAnimation
          onClose={() => router.push(withVault(vault, entryViewPath))}
        />
      )}
    </>
  );
}
