import { Skeleton } from "@/components/ui/skeleton";
import type { CSSProperties } from "react";

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

/** Skeletons before the rail sections: 3 header + 4 main-canvas placeholders. */
const HEADER_SKELETONS = 3;
const MAIN_SKELETONS = 4;

type WaveStyle = CSSProperties & { "--i": number };

/**
 * Position index that phases this bar into the panel's single light sweep
 * (REEF-250) — the `.reef-shimmer` rule in globals.css turns `--i` into a
 * per-bar `animation-delay` so one soft band travels the panel in reading
 * order instead of every placeholder pulsing in lockstep.
 */
function wave(index: number): WaveStyle {
  return { "--i": index };
}

/**
 * One rail property row: a fixed-width label gutter and a full-width value,
 * mirroring `IssueFieldRow` (REEF-149) so the placeholder lines up with the
 * loaded rail. The label takes the fainter `secondary` tone and the value the
 * default `primary` tone, pre-encoding the loaded row's emphasis. `index` is
 * the label's sweep position; the value follows one step behind it.
 */
function RailRowSkeleton({ index }: { index: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Skeleton
        tone="secondary"
        style={wave(index)}
        className="h-3 w-12 shrink-0"
      />
      <Skeleton style={wave(index + 1)} className="h-8 min-w-0 flex-1" />
    </div>
  );
}

/**
 * One rail section: an uppercase header followed by N property rows, mirroring
 * `IssueFormSection` and its `IssueFieldRow` children. `startIndex` is the
 * header's sweep position; each row then spends two indices (label + value).
 */
function RailSectionSkeleton({
  rows,
  startIndex,
}: {
  rows: readonly string[];
  startIndex: number;
}) {
  return (
    <div className="grid gap-3">
      <Skeleton
        tone="secondary"
        style={wave(startIndex)}
        className="h-3 w-16"
      />
      {rows.map((row, k) => (
        <RailRowSkeleton key={row} index={startIndex + 1 + k * 2} />
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
 *
 * On top of that REEF-249 structure, REEF-250 gives the placeholders a shared
 * design language: each `Skeleton` carries a reading-order `--i` so one calm
 * light source sweeps the panel, and labels / section headers take the fainter
 * `secondary` tone while value placeholders keep the default `primary` tone.
 */
export function IssueDetailSkeleton() {
  // Sweep positions are assigned in DOM (reading) order. Rail sections start
  // after the header + main-canvas skeletons; each rail row spends two indices,
  // so the offsets below are derived from the row arrays' lengths and stay
  // correct if a row list grows.
  const detailsStart = HEADER_SKELETONS + MAIN_SKELETONS;
  const labelsStart = detailsStart + 1 + DETAILS_ROWS.length * 2;
  const peopleStart = labelsStart + 2;
  const planningStart = peopleStart + 1 + PEOPLE_ROWS.length * 2;

  return (
    <div
      data-testid="issue-detail-skeleton"
      className="flex flex-col gap-5 p-6"
    >
      {/* Header row — the id / type cluster (mirrors IssueDetailHeader's
          left side). The top-right corner is left empty on purpose: every state
          that renders this skeleton (IssueDetail isPending/!data,
          IssueDetailSheet vaultLoading) pins the real IssueDetailCloseButton
          there (`absolute top-4 right-4`), and REEF-111 relies on those states
          having nothing else in that corner to collide with. The actions menu
          exists in the loaded header, so the live close owns the corner. */}
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton style={wave(0)} className="h-3 w-3 rounded-full" />
        <Skeleton style={wave(1)} className="h-4 w-16" />
        <Skeleton style={wave(2)} className="h-5 w-12 rounded-full" />
      </div>

      {/* Two-column grid: main canvas + 340px rail (mirrors IssueDetail). */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main canvas: title field + description editor
            (mirrors IssueDetailMain). */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton tone="secondary" style={wave(3)} className="h-3 w-10" />
            <Skeleton style={wave(4)} className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton tone="secondary" style={wave(5)} className="h-3 w-20" />
            <Skeleton style={wave(6)} className="h-44 w-full" />
          </div>
        </div>

        {/* Property rail: Details / People / Planning sections
            (mirrors IssueDetailSidebar). */}
        <div className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <RailSectionSkeleton rows={DETAILS_ROWS} startIndex={detailsStart} />
          {/* Labels keeps a stacked label-above layout in the loaded rail. */}
          <div className="flex flex-col gap-1">
            <Skeleton
              tone="secondary"
              style={wave(labelsStart)}
              className="h-3 w-12"
            />
            <Skeleton style={wave(labelsStart + 1)} className="h-9 w-full" />
          </div>
          <RailSectionSkeleton rows={PEOPLE_ROWS} startIndex={peopleStart} />
          <RailSectionSkeleton
            rows={PLANNING_ROWS}
            startIndex={planningStart}
          />
        </div>
      </div>
    </div>
  );
}
