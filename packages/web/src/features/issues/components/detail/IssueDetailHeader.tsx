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
import type { IssueType, Status } from "@reef/core";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
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
}) {
  return (
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
  );
}
