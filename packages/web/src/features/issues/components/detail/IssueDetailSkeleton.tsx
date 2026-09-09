"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { SECTION_HEADER_CLASS } from "@/components/FormSection";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
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
const PARENT_ROWS = ["parent"] as const;
/** Relationship fields rendered in the property rail under Parent. */
const RELATIONSHIP_ROWS = ["depends", "blocks", "related"] as const;
/** Placeholder event rows under the activity composer. */
const ACTIVITY_ROWS = ["a", "b", "c"] as const;

/** Skeletons before the title: none — the identity row that used to head the
 *  panel now lives in the sheet's persistent chrome bar (REEF-286), so the body
 *  skeleton opens straight on the title. Kept as a named `0` so the derived sweep
 *  offsets below stay self-documenting. */
const HEADER_SKELETONS = 0;
const TITLE_SKELETONS = 2;
const DESCRIPTION_SKELETONS = 2;
/** Main-column sub-issues empty/list section: one header + one row. */
const SUB_ISSUE_SKELETONS = 2;
/** Main-column linked documents summary: one header + one row. */
const LINKED_DOCUMENT_SKELETONS = 2;
/** Main-column refs editor summary: one header + one editor block. */
const REF_SKELETONS = 2;
/** Activity section: one header + the composer + one bar per event row. */
const ACTIVITY_SKELETONS = 1 + 1 + ACTIVITY_ROWS.length;
/** Everything the main canvas paints before the rail begins (title +
 *  description + sub-issues + linked docs + refs + activity), so the rail's
 *  sweep indices follow the main column in reading order. */
const MAIN_SKELETONS =
  TITLE_SKELETONS +
  DESCRIPTION_SKELETONS +
  SUB_ISSUE_SKELETONS +
  LINKED_DOCUMENT_SKELETONS +
  REF_SKELETONS +
  ACTIVITY_SKELETONS;

type WaveStyle = CSSProperties & { "--i": number };

/**
 * Position index that phases this bar into the panel's single light sweep
 * (REEF-250) — the `.reef-shimmer` rule in app/styles/motion.css turns `--i` into a
 * per-bar `animation-delay` so one soft band travels the panel in reading
 * order instead of every placeholder pulsing in lockstep.
 */
function wave(index: number): WaveStyle {
  return { "--i": index };
}

/** Keep the real field/section label visible over its reserved label slot. */
function LabeledSkeleton({
  label,
  testId,
  labelClassName = "type-detail-section text-muted-foreground",
}: {
  label: string;
  testId?: string;
  labelClassName?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn("min-w-0 truncate", labelClassName)}
    >
      {label}
    </span>
  );
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
function RailRowSkeleton({ index, label }: { index: number; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <LabeledSkeleton
        label={label}
        labelClassName="w-20 shrink-0 text-xs font-medium text-muted-foreground"
      />
      <Skeleton
        aria-hidden="true"
        style={wave(index + 1)}
        className="h-8 min-w-0 flex-1"
      />
    </div>
  );
}

/**
 * One rail section: an uppercase header followed by N property rows, mirroring
 * `IssueFormSection` and its `IssueFieldRow` children. `startIndex` is the
 * header's sweep position; each row then spends two indices (label + value).
 */
function RailSectionSkeleton({
  title,
  rows,
  startIndex,
}: {
  title: string;
  rows: readonly { key: string; label: string }[];
  startIndex: number;
}) {
  return (
    <div className="grid gap-3">
      <LabeledSkeleton label={title} labelClassName={SECTION_HEADER_CLASS} />
      {rows.map((row, k) => (
        <RailRowSkeleton
          key={row.key}
          label={row.label}
          index={startIndex + 1 + k * 2}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for the `IssueDetail` body while the issue is loading. It
 * mirrors the loaded layout component-for-component — the two-column grid of the
 * main canvas and the 400px property rail with its Details / People / Planning /
 * Parent / Relations sections — so the panel settles into the same shape instead
 * of flashing one full-panel block that then rearranges into a different
 * structure. The identity row is no longer mirrored here: it lives in the sheet's
 * persistent chrome bar (REEF-286), which stays put while this body skeleton
 * swaps in and out.
 *
 * The main canvas reserves the loaded column's full height: title + description
 * (the description bar sized to the MarkdownEditor's toolbar + 320px initial
 * body frame, not a short stub), then Sub-issues, linked documents, refs, and the Activity
 * timeline + composer below it. Before REEF-258 it stopped after the description,
 * so the panel grew ~2× when the real lower sections hydrated in; the reserved
 * sections keep the visible region from jumping.
 *
 * On top of that structure, REEF-250 gives the placeholders a shared design
 * language: each `Skeleton` carries a reading-order `--i` so one calm light
 * source sweeps the panel, and labels / section headers take the fainter
 * `secondary` tone while value placeholders keep the default `primary` tone.
 */
export function IssueDetailSkeleton() {
  const c = useTranslations("common");
  const sections = useTranslations("sections");
  const nav = useTranslations("nav");
  const relations = useTranslations("issues.relations");
  const refs = useTranslations("issues.refs");
  const fieldNames = useFieldNameLabels();
  const detailRows = DETAILS_ROWS.map((key) => ({
    key,
    label: fieldNames[key],
  }));
  const peopleRows = PEOPLE_ROWS.map((key) => ({
    key,
    label: fieldNames[key],
  }));
  const planningRows = PLANNING_ROWS.map((key) => ({
    key,
    label: fieldNames[key],
  }));
  const parentRows = PARENT_ROWS.map((key) => ({
    key,
    label: fieldNames[key],
  }));
  const relationshipRows = RELATIONSHIP_ROWS.map((key) => ({
    key,
    label:
      key === "depends"
        ? fieldNames.dependsOn
        : key === "blocks"
          ? fieldNames.blocks
          : fieldNames.related,
  }));
  // Sweep positions are assigned in DOM (reading) order. The main canvas spends
  // HEADER_SKELETONS..(HEADER_SKELETONS + MAIN_SKELETONS - 1); the rail begins
  // after it. Each rail row spends two indices, so the offsets below are derived
  // from the row arrays' lengths and stay correct if a row list grows.
  const subIssuesStart =
    HEADER_SKELETONS + TITLE_SKELETONS + DESCRIPTION_SKELETONS;
  const linkedDocumentsStart = subIssuesStart + SUB_ISSUE_SKELETONS;
  const refsStart = linkedDocumentsStart + LINKED_DOCUMENT_SKELETONS;
  const activityStart = refsStart + REF_SKELETONS;
  const detailsStart = HEADER_SKELETONS + MAIN_SKELETONS;
  const labelsStart = detailsStart + 1 + DETAILS_ROWS.length * 2;
  const peopleStart = labelsStart + 2;
  const planningStart = peopleStart + 1 + PEOPLE_ROWS.length * 2;
  const parentStart = planningStart + 1 + PLANNING_ROWS.length * 2;
  const relationshipsStart = parentStart + 1 + PARENT_ROWS.length * 2;

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
      <div className="flex flex-col gap-5">
        {/* Two-column grid: main canvas + 400px rail (mirrors IssueDetail). The
            identity row is not mirrored — the sheet's persistent chrome bar owns
            it across loading (REEF-286), so the body skeleton opens on the
            canvas. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Main canvas: title + description + Sub-issues + linked documents +
            refs + activity (mirrors IssueDetailMain). */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <LabeledSkeleton
                label={fieldNames.title}
                testId="issue-detail-title-label"
                labelClassName="text-xs font-medium text-muted-foreground"
              />
              {/* Title value matches the `Input` height (h-8), not h-9. */}
              <Skeleton
                aria-hidden="true"
                style={wave(HEADER_SKELETONS + 1)}
                className="h-8 w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <LabeledSkeleton
                label={fieldNames.description}
                testId="issue-detail-description-label"
                labelClassName="text-xs font-medium text-muted-foreground"
              />
              {/* Description value reserves the MarkdownEditor's height: a ~36px
                toolbar strip over its 320px initial body frame (≈356px), so the
                editor chunk loading in does not push the sections below down. */}
              <Skeleton
                aria-hidden="true"
                style={wave(HEADER_SKELETONS + 3)}
                className="h-[356px] w-full"
              />
            </div>

            {/* Sub-issues — section header + empty/list row. Consistently
              rendered in the loaded panel, so reserve it here. */}
            <div className="grid gap-3">
              <LabeledSkeleton label={relations("subIssues")} />
              <Skeleton
                aria-hidden="true"
                style={wave(subIssuesStart + 1)}
                className="h-10 w-full"
              />
            </div>

            {/* Linked documents — compact summary block below Sub-issues. */}
            <div className="grid gap-3">
              <LabeledSkeleton label={refs("linkedDocuments")} />
              <Skeleton
                aria-hidden="true"
                style={wave(linkedDocumentsStart + 1)}
                className="h-10 w-full"
              />
            </div>

            {/* External / implementation refs editor summary. */}
            <div className="grid gap-3">
              <LabeledSkeleton label={refs("deliveryLinks")} />
              <Skeleton
                aria-hidden="true"
                style={wave(refsStart + 1)}
                className="h-16 w-full"
              />
            </div>

            {/* Activity timeline + comment composer (REEF-064) — consistently rendered
              at the bottom of the loaded canvas and typically tall, so a couple
              of event rows under the composer keep the panel from doubling in
              height when it hydrates. */}
            <div className="grid gap-3">
              <LabeledSkeleton label={nav("activity")} />
              <Skeleton
                aria-hidden="true"
                style={wave(activityStart + 1)}
                className="h-20 w-full"
              />
              {ACTIVITY_ROWS.map((row, k) => (
                <Skeleton
                  aria-hidden="true"
                  key={row}
                  style={wave(activityStart + 2 + k)}
                  className="h-12 w-full"
                />
              ))}
            </div>
          </div>

          {/* Property rail: Details / People / Planning / Parent / Relations sections
            (mirrors IssueDetailSidebar). */}
          <div className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <RailSectionSkeleton
              title={sections("details")}
              rows={detailRows}
              startIndex={detailsStart}
            />
            {/* Labels keeps a stacked label-above layout in the loaded rail. */}
            <div className="flex flex-col gap-1">
              <LabeledSkeleton
                label={fieldNames.labels}
                labelClassName="text-xs font-medium text-muted-foreground"
              />
              <Skeleton
                aria-hidden="true"
                style={wave(labelsStart + 1)}
                className="h-9 w-full"
              />
            </div>
            <RailSectionSkeleton
              title={sections("people")}
              rows={peopleRows}
              startIndex={peopleStart}
            />
            <RailSectionSkeleton
              title={sections("planning")}
              rows={planningRows}
              startIndex={planningStart}
            />
            <RailSectionSkeleton
              title={fieldNames.parent}
              rows={parentRows}
              startIndex={parentStart}
            />
            <RailSectionSkeleton
              title={sections("relationships")}
              rows={relationshipRows}
              startIndex={relationshipsStart}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
