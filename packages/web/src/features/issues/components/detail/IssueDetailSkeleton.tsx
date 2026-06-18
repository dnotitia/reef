import { Skeleton } from "@/components/ui/skeleton";

/** Rail keys give the mapped rows stable React keys without index-as-key. */
const DETAILS_ROWS = ["type", "status", "priority", "severity"] as const;
const PEOPLE_ROWS = ["assignee", "requester", "reporter"] as const;
const PLANNING_ROWS = [
  "start",
  "due",
  "sprint",
  "milestone",
  "release",
  "points",
] as const;

/**
 * One rail property row: a fixed-width label gutter and a full-width value,
 * mirroring `IssueFieldRow` (REEF-149) so the placeholder lines up with the
 * loaded rail.
 */
function RailRowSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Skeleton className="h-3 w-12 shrink-0" />
      <Skeleton className="h-8 min-w-0 flex-1" />
    </div>
  );
}

/**
 * One rail section: an uppercase header followed by N property rows, mirroring
 * `IssueFormSection` and its `IssueFieldRow` children.
 */
function RailSectionSkeleton({ rows }: { rows: readonly string[] }) {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-3 w-16" />
      {rows.map((row) => (
        <RailRowSkeleton key={row} />
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for `IssueDetail` while the issue is loading. It mirrors
 * the loaded layout component-for-component — the header row, then the
 * two-column grid of the main canvas (title + description) and the 340px
 * property rail with its Details / People / Planning sections — so the panel
 * settles into the same shape instead of flashing one full-panel block that
 * then rearranges into a different structure.
 */
export function IssueDetailSkeleton() {
  return (
    <div
      data-testid="issue-detail-skeleton"
      className="flex flex-col gap-5 p-6"
    >
      {/* Header row — only the id / type cluster (mirrors IssueDetailHeader's
          left side). The top-right corner is left empty on purpose: every state
          that renders this skeleton (IssueDetail isPending/!data,
          IssueDetailSheet vaultLoading) pins the real IssueDetailCloseButton
          there (`absolute top-4 right-4`), and REEF-111 relies on those states
          having nothing else in that corner to collide with. The actions menu
          exists only in the loaded header, so the live close owns the corner. */}
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>

      {/* Two-column grid: main canvas + 340px rail (mirrors IssueDetail). */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main canvas: title field + description editor
            (mirrors IssueDetailMain). */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-44 w-full" />
          </div>
        </div>

        {/* Property rail: Details / People / Planning sections
            (mirrors IssueDetailSidebar). */}
        <div className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <RailSectionSkeleton rows={DETAILS_ROWS} />
          {/* Labels keeps a stacked label-above layout in the loaded rail. */}
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-9 w-full" />
          </div>
          <RailSectionSkeleton rows={PEOPLE_ROWS} />
          <RailSectionSkeleton rows={PLANNING_ROWS} />
        </div>
      </div>
    </div>
  );
}
