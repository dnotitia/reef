"use client";

import { Maximize2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IssueChromeIdentity } from "./IssueChromeIdentity";
import { IssueDetailSkeleton } from "./IssueDetailSkeleton";
import { IssuesWorkspaceSkeleton } from "../filters/IssuesWorkspaceSkeleton";

/**
 * Safe, non-interactive detail frame shown before the authenticated Sheet can
 * mount. The same surface bridges WorkspaceGuard's auth-pending state and the
 * base route's hydration handoff without rendering protected issue data.
 */
export function IssueDetailAuthPendingSkeleton({
  issueId,
  searchParams,
  showWorkspaceSkeleton = true,
  overlayOnly = false,
}: {
  issueId: string;
  searchParams: string;
  showWorkspaceSkeleton?: boolean;
  overlayOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  return (
    <div
      className={
        overlayOnly ? "pointer-events-none" : "relative h-full min-h-0 min-w-0"
      }
    >
      {showWorkspaceSkeleton ? (
        <div aria-hidden="true" className="h-full">
          <IssuesWorkspaceSkeleton searchParams={searchParams} />
        </div>
      ) : null}
      <div
        className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]"
        style={overlayOnly ? { pointerEvents: "auto" } : undefined}
        aria-hidden="true"
      />
      <div
        data-testid="issue-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={issueId}
        ref={dialogRef}
        tabIndex={-1}
        className="issue-detail-sheet fixed inset-y-0 right-0 z-50 flex min-w-0 flex-col overflow-hidden border-l border-border-subtle bg-surface-elevated shadow-xl shadow-foreground/10"
        style={{
          width:
            "min(var(--reef-issue-detail-initial-width, var(--issue-detail-width-default)), 94vw)",
          maxWidth: "var(--issue-detail-width-default)",
          ...(overlayOnly ? { pointerEvents: "auto" } : {}),
        }}
      >
        <div
          data-testid="issue-detail-chrome"
          className="issue-detail-chrome flex items-center gap-2 px-6 pt-4 max-[480px]:pb-1"
        >
          <IssueChromeIdentity
            issueId={issueId}
            status={undefined}
            issueType={undefined}
            parentId={null}
            allIssues={[]}
            allIssuesPending
          />
          <div className="issue-detail-actions flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
            >
              <Maximize2 className="h-4 w-4" />
            </span>
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div
          data-testid="issue-detail-scroll"
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          <IssueDetailSkeleton />
        </div>
      </div>
    </div>
  );
}
