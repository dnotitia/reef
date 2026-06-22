"use client";

import { IssueDetailSheet } from "@/features/issues/components/detail/IssueDetailSheet";
import { IssuesWorkspace } from "@/features/issues/components/filters/IssuesWorkspace";
import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";
import { useHydrated } from "@/lib/useHydrated";
import { useRouter } from "next/navigation";
import { Suspense, use } from "react";

interface IssuePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Base route for /issues/[id] — reached on hard navigation
 * (refresh, paste-into-address-bar, deep link from Slack/email).
 *
 * Soft navigation from /issues (any view) or /activity is intercepted by
 * `(dashboard)/@modal/(.)issues/[id]/page.tsx` instead, so this file just
 * runs when the URL was hit cold.
 *
 * UX: the IssuesWorkspace fills the layout slot as a backdrop and the
 * IssueDetailSheet slide-over sits on top. On a cold hit there is no `?view=`,
 * so the workspace defaults to the Board view. A cold hit starts a depth-0
 * drill trail (REEF-270), so exiting pushes the user to /issues — we don't rely
 * on history.back() here because the tab may have started directly at this URL
 * with no prior entry.
 */
export default function IssuePage({ params }: IssuePageProps) {
  const { id } = use(params);
  const router = useRouter();

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
      {mounted && (
        <IssueDetailSheet issueId={id} onClose={() => router.push("/issues")} />
      )}
    </>
  );
}
