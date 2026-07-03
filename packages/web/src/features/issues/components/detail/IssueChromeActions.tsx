"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  Link2,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "../../lib/formatRelativeTime";
import { useIssueChromeSlot } from "./IssueChromeSlot";
import { IssueSaveStatus, type SaveStatus } from "./IssueSaveStatus";

/**
 * Right side of the issue detail sheet's persistent chrome bar (REEF-286): the
 * live save status (or the last-edited time it temporarily covers) and the ⋮
 * issue-actions menu (archive / delete). Close is the sheet's own affordance and
 * sits to this cluster's right, owned by the bar.
 *
 * Unlike the identity cluster, these are bound to the loaded body's autosave
 * machine + archive/delete mutations, so the body renders this and *portals* it
 * into the bar's slot — the React tree (and therefore the autosave state +
 * dialog wiring) stays in the body while the DOM lands in the bar. When there is
 * no chrome slot in scope (a standalone `IssueDetail` render in unit tests), it
 * falls back to rendering in-flow so the actions still appear.
 */
export function IssueChromeActions({
  updatedAt,
  saveStatus,
  onRetryLastCommit,
  isArchived,
  isArchivePending,
  isDeletePending,
  onCopyLink,
  onAskAi,
  onArchiveToggle,
  onDeleteRequested,
}: {
  updatedAt: string | null;
  saveStatus: SaveStatus;
  onRetryLastCommit: () => void;
  isArchived: boolean;
  isArchivePending: boolean;
  isDeletePending: boolean;
  onCopyLink: () => void;
  onAskAi: () => void;
  onArchiveToggle: () => void;
  onDeleteRequested: () => void;
}) {
  const slot = useIssueChromeSlot();
  const locale = useLocale();
  const t = useTranslations("issues.detailDialogs");

  const content = (
    <>
      {/* The live save-status (Saving… / Saved / Not saved · Retry) temporarily
          covers the static "Edited …" time: while a write is in flight the
          static time is meaningless, and once it settles back to idle the
          now-refreshed time reappears — so the two do not read as duplicate,
          competing labels. `error` is the sole state that escalates to a
          destructive color; the rest stay muted. */}
      {saveStatus !== "idle" ? (
        <IssueSaveStatus status={saveStatus} onRetry={onRetryLastCommit} />
      ) : updatedAt ? (
        <span
          data-testid="issue-updated-at"
          className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums"
          title={t("lastEdited", {
            time: formatAbsoluteTime(updatedAt, locale),
          })}
        >
          {t("edited", { time: formatRelativeTime(updatedAt, locale) })}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          data-testid="issue-more-trigger"
          aria-label={t("issueActions")}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/* "Ask AI about this issue" and Copy link sit at the top as the
              neutral, non-mutating wayfinding actions — above the state-change
              (archive) and destructive (delete) items, matching the reference
              overflow-menu pattern rather than crowding the width-constrained
              bar with standing buttons. */}
          <DropdownMenuItem
            data-testid="issue-ask-ai"
            onSelect={() => onAskAi()}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t("askAiAboutIssue")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="issue-copy-link"
            onSelect={() => onCopyLink()}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {t("copyLink")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="issue-archive-toggle"
            onSelect={() => {
              if (isArchivePending) return;
              onArchiveToggle();
            }}
          >
            {isArchived ? (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" />
                {t("unarchive")}
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" />
                {t("archive")}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="issue-delete-trigger"
            onSelect={() => {
              if (isDeletePending) return;
              onDeleteRequested();
            }}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t("deleteEllipsis")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  // Portal into the bar's slot (a `display:contents` node, so these become flex
  // siblings of Close). With no slot in scope, render in-flow as a fallback.
  if (slot) return createPortal(content, slot);
  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {content}
    </div>
  );
}
