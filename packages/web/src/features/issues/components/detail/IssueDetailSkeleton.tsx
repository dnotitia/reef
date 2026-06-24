import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
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

/** The four relationship fields the loaded main canvas renders in a 2-col grid
 *  (Parent / Depends on / Blocks / Related — IssueDetailMain). */
const RELATIONSHIP_ROWS = ["parent", "depends", "blocks", "related"] as const;
/** Placeholder event rows under the activity composer. */
const ACTIVITY_ROWS = ["a", "b", "c"] as const;

/** Skeletons before the title: none — the identity row that used to head the
 *  panel now lives in the sheet's persistent chrome bar (REEF-286), so the body
 *  skeleton opens straight on the title. Kept as a named `0` so the derived sweep
 *  offsets below stay self-documenting. */
const HEADER_SKELETONS = 0;
const TITLE_SKELETONS = 2;
const DESCRIPTION_SKELETONS = 2;
/** Relationships section: one header + a label/value pair per field. */
const RELATIONSHIP_SKELETONS = 1 + RELATIONSHIP_ROWS.length * 2;
/** Activity section: one header + the composer + one bar per event row. */
const ACTIVITY_SKELETONS = 1 + 1 + ACTIVITY_ROWS.length;
/** Everything the main canvas paints before the rail begins (title +
 *  description + relationships + activity), so the rail's sweep indices follow
 *  the main column in reading order. */
const MAIN_SKELETONS =
  TITLE_SKELETONS +
  DESCRIPTION_SKELETONS +
  RELATIONSHIP_SKELETONS +
  ACTIVITY_SKELETONS;

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
 * loaded rail. The label gutter is `w-20` — the exact `IssueFieldRow` gutter
 * width — so the value column does not shift right when the rail hydrates
 * (REEF-258; was `w-12`). The label takes the fainter `secondary` tone and the
 * value the default `primary` tone, pre-encoding the loaded row's emphasis.
 * `index` is the label's sweep position; the value follows one step behind it.
 */
function RailRowSkeleton({ index }: { index: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Skeleton
        tone="secondary"
        style={wave(index)}
        className="h-3 w-20 shrink-0"
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
 * Skeleton placeholder for the `IssueDetail` body while the issue is loading. It
 * mirrors the loaded layout component-for-component — the two-column grid of the
 * main canvas and the 340px property rail with its Details / People / Planning
 * sections — so the panel settles into the same shape instead of flashing one
 * full-panel block that then rearranges into a different structure. The identity
 * row is no longer mirrored here: it lives in the sheet's persistent chrome bar
 * (REEF-286), which stays put while this body skeleton swaps in and out.
 *
 * The main canvas reserves the loaded column's full height: title + description
 * (the description bar sized to the MarkdownEditor's toolbar + 200px body floor,
 * not a short stub), then the persistent Relationships section and the
 * Activity timeline + composer below it. Before REEF-258 it stopped after the
 * description, so the panel grew ~2× when the real relationships + activity
 * hydrated in; the reserved sections keep the visible region from jumping.
 *
 * On top of that structure, REEF-250 gives the placeholders a shared design
 * language: each `Skeleton` carries a reading-order `--i` so one calm light
 * source sweeps the panel, and labels / section headers take the fainter
 * `secondary` tone while value placeholders keep the default `primary` tone.
 */
export function IssueDetailSkeleton() {
  const c = useTranslations("common");
  // Sweep positions are assigned in DOM (reading) order. The main canvas spends
  // HEADER_SKELETONS..(HEADER_SKELETONS + MAIN_SKELETONS - 1); the rail begins
  // after it. Each rail row spends two indices, so the offsets below are derived
  // from the row arrays' lengths and stay correct if a row list grows.
  const relationshipsStart =
    HEADER_SKELETONS + TITLE_SKELETONS + DESCRIPTION_SKELETONS;
  const activityStart = relationshipsStart + RELATIONSHIP_SKELETONS;
  const detailsStart = HEADER_SKELETONS + MAIN_SKELETONS;
  const labelsStart = detailsStart + 1 + DETAILS_ROWS.length * 2;
  const peopleStart = labelsStart + 2;
  const planningStart = peopleStart + 1 + PEOPLE_ROWS.length * 2;

  return (
    <div
      data-testid="issue-detail-skeleton"
      className="flex flex-col gap-5 p-6"
    >
      {/* screen-reader loading announcement (REEF-281), sibling to the decorative
          panel so it is not under aria-hidden. */}
      <output className="sr-only">{c("loading")}</output>
      {/* The mirrored panel is all placeholder bars — decorative, so aria-hidden
          keeps assistive tech from walking the empty canvas/rail DOM. */}
      <div className="flex flex-col gap-5" aria-hidden="true">
        {/* Two-column grid: main canvas + 340px rail (mirrors IssueDetail). The
            identity row is not mirrored — the sheet's persistent chrome bar owns
            it across loading (REEF-286), so the body skeleton opens on the
            canvas. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Main canvas: title + description + relationships + activity
            (mirrors IssueDetailMain). */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Skeleton
                tone="secondary"
                style={wave(HEADER_SKELETONS)}
                className="h-3 w-10"
              />
              {/* Title value matches the `Input` height (h-8), not h-9. */}
              <Skeleton
                style={wave(HEADER_SKELETONS + 1)}
                className="h-8 w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Skeleton
                tone="secondary"
                style={wave(HEADER_SKELETONS + 2)}
                className="h-3 w-20"
              />
              {/* Description value reserves the MarkdownEditor's height: a ~36px
                toolbar strip over its 200px body floor (≈236px → h-60), so the
                editor chunk loading in does not push the sections below down. */}
              <Skeleton
                style={wave(HEADER_SKELETONS + 3)}
                className="h-60 w-full"
              />
            </div>

            {/* Relationships — IssueFormSection "Relationships" + its 2-col grid
              of Parent / Depends on / Blocks / Related fields. Consistently rendered
              in the loaded panel, so reserve it here. */}
            <div className="grid gap-3">
              <Skeleton
                tone="secondary"
                style={wave(relationshipsStart)}
                className="h-3 w-24"
              />
              <div className="grid gap-3 md:grid-cols-2">
                {RELATIONSHIP_ROWS.map((row, k) => (
                  <div key={row} className="flex flex-col gap-1">
                    <Skeleton
                      tone="secondary"
                      style={wave(relationshipsStart + 1 + k * 2)}
                      className="h-3 w-16"
                    />
                    <Skeleton
                      style={wave(relationshipsStart + 2 + k * 2)}
                      className="h-8 w-full"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Activity timeline + comment composer (REEF-064) — consistently rendered
              at the bottom of the loaded canvas and typically tall, so a couple
              of event rows under the composer keep the panel from doubling in
              height when it hydrates. */}
            <div className="grid gap-3">
              <Skeleton
                tone="secondary"
                style={wave(activityStart)}
                className="h-3 w-20"
              />
              <Skeleton
                style={wave(activityStart + 1)}
                className="h-20 w-full"
              />
              {ACTIVITY_ROWS.map((row, k) => (
                <Skeleton
                  key={row}
                  style={wave(activityStart + 2 + k)}
                  className="h-12 w-full"
                />
              ))}
            </div>
          </div>

          {/* Property rail: Details / People / Planning sections
            (mirrors IssueDetailSidebar). */}
          <div className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <RailSectionSkeleton
              rows={DETAILS_ROWS}
              startIndex={detailsStart}
            />
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
    </div>
  );
}
