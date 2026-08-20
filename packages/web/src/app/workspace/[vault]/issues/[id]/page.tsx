"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { useHydrated } from "@/lib/useHydrated";
import { withVault } from "@/lib/workspaceHref";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";

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
 * this URL with no prior entry. Once a relationship drill activates the
 * intercepting parallel route, the base sheet yields to that route so the
 * session has one visible sheet rather than a stacked duplicate.
 */
export default function IssuePage({ params }: IssuePageProps) {
  const { id, vault } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasDrilledInSession = useIssueNavStack(
    (state) => state.hasDrilledInSession,
  );
  // Route-local (not persisted): once this base page hands the session to
  // the intercepting slot, it stays hidden even when Back unwinds to the
  // original issue, preventing the two parallel sheets from stacking again.
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
  // then mounts (and animates in) afterward. The intercepting soft-nav route
  // doesn't need this — its backdrop hydrated before the sheet ever opens.
  const mounted = useHydrated();

  return (
    <>
      <Suspense fallback={<IssuesWorkspaceSkeleton />}>
        <IssuesWorkspace />
      </Suspense>
      {mounted && !hasDrilledInSession && (
        <IssueDetailSheet
          issueId={id}
          onClose={() => router.push(withVault(vault, entryViewPath))}
        />
      )}
    </>
  );
}
