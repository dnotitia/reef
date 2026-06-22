"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIssueSheetDismiss } from "@/features/issues/hooks/view/useIssueSheetDismiss";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import Link from "next/link";
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

  // These two states render no IssueDetailHeader (and therefore no header
  // close button), so the sheet itself supplies the close affordance. The
  // loaded IssueDetail path owns its own close button in the header instead.
  const showFallbackClose = vaultLoading || !vault;

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
          // IssueDetailHeader renders its own close button next to the issue
          // actions menu, so the overlay X is suppressed here to avoid a
          // duplicate, colliding affordance in the top-right corner.
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
              without duplicating the PM-facing header rendered inside
              IssueDetail. */}
          <SheetTitle className="sr-only">Issue {issueId}</SheetTitle>
          <SheetDescription className="sr-only">
            Edit details for issue {issueId}.
          </SheetDescription>
          {showFallbackClose ? (
            <IssueDetailCloseButton
              onClose={exit}
              className="absolute top-4 right-4 z-10"
            />
          ) : null}
          {/* Drill Back chrome sits above the body in every state (loaded,
              skeleton, error, no-vault) so it stays available while a drilled-in
              issue loads. The nested flex column drops the SheetContent gap
              between the strip and the body. */}
          <div className="flex flex-col">
            {backTo ? (
              <IssueDrillBackBar backTo={backTo} onBack={goBack} />
            ) : null}
            {renderBody()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
