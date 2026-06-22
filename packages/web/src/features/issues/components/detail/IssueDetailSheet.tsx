"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIssue } from "@/features/issues/hooks/queries/useIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueSheetDismiss } from "@/features/issues/hooks/view/useIssueSheetDismiss";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import Link from "next/link";
import { useState } from "react";
import { IssueChromeIdentity } from "./IssueChromeIdentity";
import { IssueChromeSlotProvider } from "./IssueChromeSlot";
import { IssueDetail } from "./IssueDetail";
import { IssueDetailCloseButton } from "./IssueDetailCloseButton";
import { IssueDetailSkeleton } from "./IssueDetailSkeleton";
import { IssueDrillBackBar } from "./IssueDrillBackBar";

interface IssueDetailSheetProps {
  /** Issue ID like "REEF-001". */
  issueId: string;
  /**
   * Exit the sheet to its entry view (the list/board the user came from). Used
   * by Close, by an outside click, and by Esc when there is no drill trail. The
   * soft-nav intercepting route passes `router.back()`; the deep-link base route
   * passes `router.push("/issues")`. Back/Esc within a drill trail are handled
   * internally via the in-memory nav stack (REEF-270).
   */
  onClose: () => void;
}

/**
 * Shared slide-over wrapper for the IssueDetail panel. Both the
 * intercepting route (soft nav) and the base route (deep link) mount this
 * so the chrome stays identical — the entry-exit target differs.
 *
 * Persistent chrome bar (REEF-286): the sheet owns a single top bar that lives
 * *outside* the body — wayfinding + identity on the left (drill Back · parent
 * breadcrumb · status · id · type), actions on the right (save status · ⋮ ·
 * Close). The bar renders in every state (loaded, skeleton, error, no-vault), so
 * the id (from the route param) and Close are always present and Back persists
 * while a drilled-in, uncached issue loads — only the body below skeletons. The
 * data-dependent identity (status / type / breadcrumb) is read here from
 * `useIssue` / `useIssueList` and fills in on arrival; the body portals its
 * action cluster (save status + ⋮) into the bar's slot so the autosave + dialog
 * wiring stays in the body while the controls render in the bar.
 *
 * Drill navigation (REEF-270): following a relationship link swaps the content
 * in place and records the hop on an in-memory nav stack. A top-left Back
 * unwinds one hop; Close / outside click exit the whole trail to the entry view;
 * Esc means Back while drilled in, Close otherwise.
 */
export function IssueDetailSheet({ issueId, onClose }: IssueDetailSheetProps) {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { backTo, goBack, exit, dismissViaEsc } = useIssueSheetDismiss({
    issueId,
    onExit: onClose,
  });

  // Identity data for the persistent bar. Read here (not in the body) so the
  // status glyph / type pill / parent breadcrumb fill the bar the moment they
  // land and survive the body skeleton. Both queries are vault-gated, so while
  // the vault pointer is loading or unset they stay pending and the bar shows
  // the route-param id alone. `useUpdateIssue` patches these caches
  // optimistically (REEF-098), so an inline status / type / parent edit reflects
  // in the bar immediately.
  const { data } = useIssue(issueId, vault);
  const { data: allIssues, isPending: allIssuesPending } = useIssueList(vault);
  const issue = data?.issue;

  // The bar's action slot: the loaded body portals its save-status + ⋮ cluster
  // here, so that wiring stays in the body while the controls land in the bar.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  // `useIssue` is gated on `vault`. When the pointer is still loading or
  // unset, TanStack Query v5 keeps the query in `isPending: true`, which
  // would leave a permanent skeleton — so we render the skeleton / empty
  // CTA ourselves here instead of mounting `IssueDetail` empty.
  function renderBody() {
    if (vaultLoading) return <IssueDetailSkeleton />;
    if (!vault) {
      return (
        <div
          data-testid="issue-detail-no-vault"
          className="p-6 text-sm text-muted-foreground"
        >
          Configure a workspace in{" "}
          <Link href="/settings" className="text-brand underline">
            Settings
          </Link>{" "}
          to view this issue.
        </div>
      );
    }
    // Key by vault so an active-vault switch (now reachable from anywhere via
    // the sidebar workspace switcher, REEF-146) fully remounts the detail with
    // fresh state from a fresh query. Without this the form re-syncs on issue
    // id just, so a same-id issue in the new workspace would briefly show — and
    // could autosave — the previous workspace's edited values. Same-id
    // navigation within one vault keeps the key stable, preserving the
    // edit-across-refetch behavior IssueDetail relies on.
    return (
      <IssueDetail key={vault} issueId={issueId} vault={vault} onClose={exit} />
    );
  }

  return (
    <div data-testid="issue-detail-modal">
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) exit();
        }}
      >
        <SheetContent
          side="right"
          // The sheet's own persistent chrome bar owns the close affordance
          // (REEF-286), so the overlay X is suppressed here to avoid a
          // duplicate, colliding control in the top-right corner.
          showCloseButton={false}
          // Esc means Back while drilled into a relation trail, Close otherwise
          // (AC3); an outside click always exits to the entry view (AC2). We own
          // both so the in-memory nav stack — not the browser history — decides
          // (REEF-270). preventDefault stops Radix's default one-step dismiss.
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            dismissViaEsc();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            exit();
          }}
          // Wider canvas (REEF-149) so the rail's property rows get full width
          // and Planning dates / Relationship inputs stop truncating.
          // `overscroll-contain` keeps a scroll at the sheet's edge from chaining
          // to the page behind it (WIG).
          className="w-[min(94vw,1080px)] sm:max-w-[1080px] overflow-y-auto overscroll-contain"
        >
          {/* Visually-hidden title/description satisfy Radix Dialog a11y
              without duplicating the PM-facing identity rendered in the bar. */}
          <SheetTitle className="sr-only">Issue {issueId}</SheetTitle>
          <SheetDescription className="sr-only">
            Edit details for issue {issueId}.
          </SheetDescription>
          {/* Single persistent chrome bar (REEF-286): wayfinding + identity on
              the left, actions + Close on the right. It renders in every state,
              so the id/Back/Close never blink while the body below skeletons, and
              no state leaves an empty band — the id always fills the bar's left
              and Close is the single control on the right (AC1 · AC2 · AC3). The
              history Back (its own `Back navigation` landmark) stays visually
              separate from the structural parent breadcrumb (`Issue hierarchy`),
              so navigation and hierarchy never read as one trail (AC4 / REEF-270
              AC5). Wrapped with the body in a no-gap column so SheetContent's
              gap-4 doesn't open between the bar and the body. */}
          <IssueChromeSlotProvider value={actionsSlot}>
            <div className="flex flex-col">
              <div
                data-testid="issue-detail-chrome"
                className="flex items-center gap-2 px-6 pt-4"
              >
                {backTo ? (
                  <IssueDrillBackBar backTo={backTo} onBack={goBack} />
                ) : null}
                <IssueChromeIdentity
                  issueId={issueId}
                  status={issue?.status}
                  issueType={issue ? (issue.issue_type ?? "task") : undefined}
                  isArchived={issue?.archived_at != null}
                  parentId={issue?.parent_id ?? null}
                  allIssues={allIssues ?? []}
                  allIssuesPending={allIssuesPending}
                />
                <div className="flex shrink-0 items-center gap-2">
                  {/* `display:contents` so the body's portaled save-status + ⋮
                      become flex siblings of Close, and the slot adds no gap
                      while it is empty during loading. */}
                  <div ref={setActionsSlot} className="contents" />
                  <IssueDetailCloseButton onClose={exit} />
                </div>
              </div>
              {renderBody()}
            </div>
          </IssueChromeSlotProvider>
        </SheetContent>
      </Sheet>
    </div>
  );
}
