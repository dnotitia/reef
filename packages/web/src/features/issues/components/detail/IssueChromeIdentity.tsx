"use client";

import { TypePill } from "@/components/fields/TypePill";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/ui/status-icon";
import { useIssueDrill } from "@/features/issues/hooks/view/useIssueDrill";
import { cn } from "@/lib/utils";
import type { IssueListItem, IssueType, Status } from "@reef/core";
import { Archive } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

/**
 * Left side of the issue detail sheet's persistent chrome bar (REEF-286): the
 * wayfinding + identity cluster — parent breadcrumb (REEF-266/279/283) ›
 * current status glyph · issue id · type pill · archived badge.
 *
 * It lives in the sheet's chrome bar, *outside* the body, so the id renders from
 * the route param the moment the sheet opens and survives the body skeleton
 * (drilling into an uncached issue no longer flashes the id). The data-dependent
 * pieces — status glyph, type pill, breadcrumb, archived badge — fill in once
 * `useIssue` / `useIssueList` land, matching the reference (Linear / Asana) bar
 * that keeps its frame while the panel below loads. The sheet reads those
 * queries and feeds them here as props, so this stays a pure presentational
 * leaf that renders id-only until `status` / `issueType` arrive.
 */
export function IssueChromeIdentity({
  issueId,
  status,
  issueType,
  isArchived = false,
  parentId,
  allIssues,
  allIssuesPending,
}: {
  /** Current issue id (the route param) — always rendered, even mid-load. */
  issueId: string;
  /** Current issue status, or undefined until the issue loads. */
  status?: Status;
  /** Current issue type, or undefined until the issue loads. */
  issueType?: IssueType;
  isArchived?: boolean;
  /** Parent issue's reef id, or null for a top-level issue / before load. */
  parentId: string | null;
  /** Whole-vault list (resolves the parent title without an extra request). */
  allIssues: readonly IssueListItem[];
  /** The whole-vault list is still loading, so a set `parentId` cannot be
   *  resolved yet — hold a neutral skeleton instead of flashing the raw id
   *  (REEF-283). */
  allIssuesPending: boolean;
}) {
  // Resolve the parent from the already-loaded list (no network request); a set
  // parent_id that is absent from the list still renders by id (REEF-266).
  const parent = useMemo(
    () =>
      parentId
        ? (allIssues.find((issue) => issue.id === parentId) ?? null)
        : null,
    [parentId, allIssues],
  );

  // Drilling to the parent is an in-sheet content swap that records the hop on
  // the nav stack (REEF-270), so a Back from the parent returns here. Modifier
  // clicks still open the parent in a fresh tab via the link href.
  const getDrillProps = useIssueDrill(issueId);

  return (
    // The breadcrumb trail — parent › current — on the bar's left. The current
    // issue is the last, "you are here" crumb; the parent is a leading crumb
    // whose title truncates first, matching Linear's breadcrumb. `flex-1`/
    // `min-w-0` lets it absorb the bar width while the right-side actions + Close
    // stay pinned.
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      {/* Parent breadcrumb (REEF-266) — a click-through link up to the parent,
          placed before the current issue. This is *navigation*; the
          Relationships `Parent` combobox stays *reassignment*, so the two do not
          duplicate-encode the parent identity. Hidden for a top-level issue and
          before the issue loads (parentId arrives with the issue). The parent's
          title truncates; the current-issue cluster stays fully visible. */}
      {parentId ? (
        <nav
          aria-label="Issue hierarchy"
          className="flex min-w-0 items-center gap-2"
        >
          <Link
            {...getDrillProps(parentId)}
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
              // the bar's content edge — the same x the status icon uses with no
              // parent — while the hover background keeps its inset padding.
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
              // parent, so the status never double-announces.
              <>
                <StatusIcon status={parent.status} size={12} decorative />
                <span className="min-w-0 truncate">{parent.title}</span>
              </>
            ) : allIssuesPending ? (
              // List still loading (REEF-283): hold a neutral skeleton — never
              // the raw reef id — so the later title is a fill, not a visible
              // "id → title" swap. The crumb is already navigable from
              // `href`/`getDrillProps(parentId)`, so it works during the wait.
              // The skeleton is decorative (aria-hidden); the link's aria-label
              // stays its only accessible name.
              <span
                aria-hidden
                data-testid="issue-parent-breadcrumb-loading"
                className="inline-flex items-center gap-1.5"
              >
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </span>
            ) : (
              // Degrade: parent_id is set but the parent is absent from the
              // already-loaded list (archived, etc.), so there is no status or
              // title to render. Fall back to the raw id so the link is never
              // empty and stays navigable (REEF-279 AC4). `translate="no"` keeps
              // machine translation from mangling the reef id.
              <span translate="no" className="shrink-0 font-mono tabular-nums">
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

      {/* Current status glyph — only once the issue lands; until then the bar
          shows the route-param id alone (no glyph flash). */}
      {status ? <StatusIcon status={status} size={12} /> : null}
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
        {issueId}
      </span>
      {issueType ? <TypePill type={issueType} variant="detail" /> : null}
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
  );
}
