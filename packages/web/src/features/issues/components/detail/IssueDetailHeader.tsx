"use client";

import { TypePill } from "@/components/fields/TypePill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import type { IssueListItem, IssueType, Status } from "@reef/core";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { formatRelativeTime } from "../../lib/formatRelativeTime";
import { IssueDetailCloseButton } from "./IssueDetailCloseButton";
import { IssueSaveStatus, type SaveStatus } from "./IssueSaveStatus";

export function IssueDetailHeader({
  issueId,
  issueType,
  status,
  isArchived,
  updatedAt,
  saveStatus,
  onRetryLastCommit,
  isArchivePending,
  isDeletePending,
  onArchiveToggle,
  onDeleteRequested,
  onClose,
  parentId,
  allIssues,
}: {
  issueId: string;
  issueType: IssueType;
  status: Status;
  isArchived: boolean;
  updatedAt: string | null;
  saveStatus: SaveStatus;
  onRetryLastCommit: () => void;
  isArchivePending: boolean;
  isDeletePending: boolean;
  onArchiveToggle: () => void;
  onDeleteRequested: () => void;
  /** Dismiss the detail sheet — same path as Esc / outside click / route back. */
  onClose: () => void;
  /** Parent issue's reef id, or null for a top-level issue (REEF-266). */
  parentId: string | null;
  /** Whole-vault list already loaded by the detail panel; resolves the parent
   *  title without an extra request. */
  allIssues: readonly IssueListItem[];
}) {
  // Resolve the parent from the already-loaded list (no network request); a set
  // parent_id that is absent from the list still renders id-only (REEF-266).
  const parent = useMemo(
    () =>
      parentId
        ? (allIssues.find((issue) => issue.id === parentId) ?? null)
        : null,
    [parentId, allIssues],
  );

  return (
    // Single-row header (REEF-266): a horizontal breadcrumb trail — parent ›
    // current — on the left, the action cluster (save state · menu · close) on
    // the right. The current issue is the last, "you are here" crumb; the parent
    // is a leading crumb whose title truncates first, matching Linear's
    // breadcrumb. The close button stays in the top-right corner.
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        {/* Parent breadcrumb (REEF-266) — a click-through link up to the parent,
            placed before the current issue. This is *navigation*; the
            Relationships `Parent` combobox stays *reassignment*, so the two never
            duplicate-encode the parent identity. Hidden for a top-level issue.
            Only the parent's title truncates; the current-issue cluster stays
            fully visible (Linear truncates the parent name, not the current id). */}
        {parentId ? (
          <nav
            aria-label="Issue hierarchy"
            className="flex min-w-0 items-center gap-2"
          >
            <Link
              href={`/issues/${parentId}`}
              data-testid="issue-parent-breadcrumb"
              data-issue-id={parentId}
              title="Go to parent issue"
              aria-label={
                parent?.title
                  ? `Parent issue ${parentId}: ${parent.title}`
                  : `Parent issue ${parentId}`
              }
              className={cn(
                // `-ml-1.5` offsets the px-1.5 so the crumb's leading text sits at
                // the panel's content edge — the same x the status icon uses with
                // no parent — while the hover background keeps its inset padding.
                "-ml-1.5 inline-flex min-w-0 touch-manipulation items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors duration-150",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              )}
            >
              {parent ? (
                // Resolved parent: lead with the parent's status glyph, then its
                // title (REEF-279). The raw reef id leaves the visible crumb — it
                // lives on only in `href`/`data-issue-id` for routing + tests — so
                // the trail reads `[status] Parent title › ● Current`, the same
                // status-first visual language as the current-issue cluster below.
                // The glyph is decorative: the link's aria-label already names the
                // parent, so the status never double-announces (AC1 · AC2 · AC3).
                <>
                  <StatusIcon status={parent.status} size={12} decorative />
                  <span className="min-w-0 truncate">{parent.title}</span>
                </>
              ) : (
                // Degrade: parent_id is set but the parent is absent from the
                // loaded list, so there is no status or title to render. Fall back
                // to the raw id so the link is never empty and stays navigable
                // (REEF-279 AC4). `translate="no"` keeps machine translation from
                // mangling the reef id (a code identifier, not prose).
                <span
                  translate="no"
                  className="shrink-0 font-mono tabular-nums"
                >
                  {parentId}
                </span>
              )}
            </Link>
            {/* Trail separator pointing from the parent to the current issue. */}
            <span aria-hidden className="shrink-0 text-muted-foreground/50">
              ›
            </span>
          </nav>
        ) : null}

        <StatusIcon status={status} size={12} />
        <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
          {issueId}
        </span>
        <TypePill type={issueType} variant="detail" />
        {isArchived && (
          <span
            data-testid="issue-archived-badge"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            <Archive className="h-3 w-3" />
            Archived
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Right meta slot. The live save-status (Saving… / Saved / Not saved ·
            Retry) temporarily covers the static "Edited …" time: while a write
            is in flight the static time is meaningless, and once it settles back
            to idle the now-refreshed time reappears — so the two does not read as
            duplicate, competing labels. error is the just state that escalates
            to a destructive color; the rest stay muted. */}
        {saveStatus !== "idle" ? (
          <IssueSaveStatus status={saveStatus} onRetry={onRetryLastCommit} />
        ) : updatedAt ? (
          <span
            data-testid="issue-updated-at"
            className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums"
            title={`Last edited ${new Date(updatedAt).toLocaleString()}`}
          >
            Edited {formatRelativeTime(updatedAt)}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            data-testid="issue-more-trigger"
            aria-label="Issue actions"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="mr-2 h-4 w-4" />
                  Archive
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
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IssueDetailCloseButton onClose={onClose} />
      </div>
    </div>
  );
}
