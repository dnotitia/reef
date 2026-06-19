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
import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
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
    <div className="flex flex-col gap-2">
      {/* Upward navigation to the parent issue (REEF-266) — the symmetric
          counterpart to the click-through Sub-issues list (REEF-081). It reuses
          IssueChildren's row interaction contract (Link + hover:bg-surface-hover
          + focus-visible ring). This is *navigation*; the Relationships `Parent`
          combobox stays *reassignment*, so the two never duplicate-encode the
          parent identity. Hidden entirely for a top-level issue. */}
      {parentId ? (
        <nav aria-label="Issue hierarchy">
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
              // `-ml-1.5` offsets the px-1.5 so the glyph sits at the same x as
              // the issue-id row's status icon below (both 12px) — the two mono
              // ids line up in one column — while the hover background keeps its
              // inset padding (REEF-266 follow-up). gap-2 matches that row's gap.
              "-ml-1.5 inline-flex max-w-full touch-manipulation items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-150",
              "hover:bg-surface-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            )}
          >
            {/* A plain up-arrow reads as "up to the parent" far better than a
                corner arrow did; combined with the id-column alignment below it
                the row stacks as parent-over-child. The explicit "Parent issue"
                wording lives in the link's aria-label/title so it is available to
                hover + assistive tech without pushing the id out of the shared
                column (REEF-266 follow-up). */}
            <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
            {/* `translate="no"` keeps machine translation from mangling the reef
                id (a code identifier, not prose). */}
            <span translate="no" className="shrink-0 font-mono tabular-nums">
              {parentId}
            </span>
            {parent?.title ? (
              <>
                <span aria-hidden className="shrink-0 text-muted-foreground/60">
                  ·
                </span>
                <span className="min-w-0 truncate">{parent.title}</span>
              </>
            ) : null}
          </Link>
        </nav>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <StatusIcon status={status} size={12} />
          <span className="font-mono text-muted-foreground tabular-nums">
            {issueId}
          </span>
          <TypePill type={issueType} variant="detail" />
          {isArchived && (
            <span
              data-testid="issue-archived-badge"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
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
    </div>
  );
}
