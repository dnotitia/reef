"use client";

import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_INACTIVE,
  CBX_TRIGGER_FIELD,
} from "@/components/ui/comboboxChrome";
import { Input } from "@/components/ui/input";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { parseIssueViewState } from "@/features/issues/lib/viewMode";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Calendar as CalendarIcon,
  Columns3,
  GanttChart,
  List,
  ListOrdered,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Placeholder widths (in `w-*` units) for the filter-bar chips, in source order.
 * The first six mirror the auto-width facet chips (Status / Type / Priority /
 * Severity / Due / Dependency — each hugs a short label), then the six value
 * fields (Assignee / Requester / Sprint / Milestone / Release / Labels) sit at
 * the shared `9rem` (`w-36`) floor, the compound updated-at trigger gets one
 * bounded placeholder, and Display closes the row. Reproducing the
 * real chip count and widths in the same `flex flex-wrap gap-2` container makes
 * the skeleton wrap to the same number of rows as the live FilterBar at any
 * width, so the toolbar holds its height when the real bar hydrates (REEF-258).
 */
const FILTER_CHIPS = [
  { key: "status", width: "w-fit", field: false },
  { key: "type", width: "w-fit", field: false },
  { key: "priority", width: "w-fit", field: false },
  { key: "severity", width: "w-fit", field: false },
  { key: "due", width: "w-fit", field: false },
  { key: "dependency", width: "w-fit", field: false },
  { key: "assignee", width: "w-fit", field: false },
  { key: "requester", width: "w-fit", field: false },
  { key: "sprint", width: "w-fit", field: false },
  {
    key: "milestone",
    width: "w-fit min-w-[9rem] max-w-[16rem]",
    field: true,
  },
  { key: "release", width: "w-fit", field: false },
  {
    key: "labels",
    width: "w-fit min-w-[9rem] max-w-[16rem]",
    field: false,
  },
  { key: "updatedAtRange", width: "w-fit", field: false },
  { key: "display", width: "w-fit", field: false },
  { key: "sort", width: "w-fit", field: false },
  { key: "myViews", width: "w-fit", field: false },
] as const;

function StaticSegmentedControl({
  testId,
  ariaLabel,
  items,
  activeId,
}: {
  testId: string;
  ariaLabel: string;
  items: ReadonlyArray<{
    id: string;
    label: string;
    icon?: typeof Columns3;
  }>;
  activeId: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-busy="true"
      data-testid={testId}
      className={SEGMENTED_CONTROL_TRACK}
    >
      {items.map(({ id, label, icon: Icon }) => (
        <span
          key={id}
          data-testid={`${testId}-${id}`}
          className={cn(
            SEGMENTED_CONTROL_ITEM,
            "whitespace-nowrap",
            id === activeId
              ? SEGMENTED_CONTROL_ITEM_ACTIVE
              : SEGMENTED_CONTROL_ITEM_INACTIVE,
          )}
        >
          {Icon ? (
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          {label}
        </span>
      ))}
    </div>
  );
}

function StaticFilterControl({
  label,
  className,
  field = false,
  icon: Icon,
  dataKey,
}: {
  label: string;
  className: string;
  field?: boolean;
  icon?: typeof Columns3;
  dataKey: string;
}) {
  return (
    <span
      data-fixed-filter="true"
      data-fixed-filter-key={dataKey}
      className={cn(
        field
          ? `${CBX_TRIGGER_FIELD} text-left`
          : `${CBX_TRIGGER_CHIP} ${CBX_TRIGGER_CHIP_INACTIVE} text-center`,
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      {label}
      <ChevronDown aria-hidden="true" className={CBX_CHEVRON} />
    </span>
  );
}

function StaticLabelInput({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      data-fixed-filter="true"
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-surface-elevated px-1.5 py-1 type-control text-foreground transition-colors duration-150",
        className,
      )}
    >
      <input
        readOnly
        tabIndex={-1}
        aria-disabled="true"
        aria-label={label}
        placeholder={label}
        className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-0.5 type-control outline-none placeholder:text-muted-foreground"
      />
    </span>
  );
}

/**
 * First-paint skeleton for the issues workspace, shared by the route's
 * `loading.tsx` (soft-nav segment fetch) and the page's `<Suspense fallback>`
 * (the `useSearchParams` CSR bail-out on a hard navigation / refresh / deep
 * link). Without a fallback that boundary renders `null`, so the body painted
 * blank until hydration — the gap REEF-255 closes.
 *
 * A cold hit carries no `?view=`, so this mirrors the default Board view: the
 * same {@link BoardColumnsSkeleton} the live board shows while pending
 * (REEF-097), so the route fallback and the hydrated pending state read
 * identically. The header + toolbar bar hold their heights so the real chrome
 * does not shove the board down when it hydrates in.
 *
 * The toolbar placeholder mirrors {@link IssueFilterToolbar}'s two rows — a
 * full-width SearchBar (`h-9`) over the wrapping FilterBar facet chips (`h-8`)
 * — so the toolbar does not grow ~50–90px and push the board down on hydration
 * (REEF-258). It does not vary the body by `?view=`: a server `loading.tsx` and
 * the CSR-bail Suspense fallback both render before the URL's view is known, so
 * the list/timeline/backlog frames stay a separate, deferred concern.
 */
export function IssuesWorkspaceSkeleton({
  searchParams = "",
}: {
  searchParams?: string;
}) {
  const nav = useTranslations("nav");
  const c = useTranslations("common");
  const filters = useTranslations("issues.filters");
  const sort = useTranslations("issues.sort");
  const fieldNames = useFieldNameLabels();
  const { scope, layout } = parseIssueViewState(
    new URLSearchParams(searchParams),
  );
  const chipLabels: Record<(typeof FILTER_CHIPS)[number]["key"], string> = {
    status: fieldNames.status,
    type: fieldNames.type,
    priority: fieldNames.priority,
    severity: fieldNames.severity,
    due: fieldNames.due,
    dependency: fieldNames.dependency,
    assignee: fieldNames.assignee,
    requester: fieldNames.requester,
    sprint: fieldNames.sprint,
    milestone: fieldNames.milestone,
    release: fieldNames.release,
    labels: fieldNames.labels,
    updatedAtRange: filters("updatedAtRange"),
    display: filters("display"),
    sort: sort("rankOrder"),
    myViews: filters("myViews"),
  };
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-testid="issues-skeleton"
    >
      {/* screen-reader loading announcement (REEF-281). Sibling to the decorative body
          so it is NOT under aria-hidden; PageHeader's h1 stays a real heading. */}
      <output className="sr-only">{c("loading")}</output>
      <PageHeader
        title={nav("issues")}
        className="h-auto min-h-12 flex-wrap py-2"
        staticTitleAdjacent={
          <StaticSegmentedControl
            testId="scope-switcher"
            ariaLabel={filters("scope.label")}
            activeId={scope}
            items={[
              { id: "active", label: filters("scope.active") },
              { id: "backlog", label: filters("scope.backlog") },
            ]}
          />
        }
        staticActions={
          <StaticSegmentedControl
            testId="view-switcher"
            ariaLabel={filters("issueView")}
            activeId={layout}
            items={[
              { id: "board", label: filters("view.board"), icon: Columns3 },
              { id: "list", label: filters("view.list"), icon: List },
              {
                id: "timeline",
                label: filters("view.timeline"),
                icon: GanttChart,
              },
            ]}
          />
        }
      />
      {/* Fixed toolbar labels use the normal control chrome; only the board's
          unresolved card/value placeholders remain Skeleton bars. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mirrors IssueFilterToolbar's outer bar (border-b · px-6 · py-2.5) and
            its SearchBar-over-FilterBar two-row stack so the toolbar appearing on
            hydration is not a vertical jump. */}
        <div
          className="flex flex-col gap-2 border-b border-border-subtle bg-surface-page px-6 py-2.5"
          data-testid="issues-skeleton-toolbar"
        >
          {/* SearchBar row (Input h-9, full width). */}
          <div
            className="relative flex w-full min-w-0 items-center"
            data-testid="search-bar"
          >
            <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              readOnly
              tabIndex={-1}
              aria-disabled="true"
              aria-label={filters("searchLabel")}
              placeholder={filters("searchPlaceholder")}
              data-testid="search-input"
              className="h-9 pl-9 pr-8"
            />
          </div>
          {/* FilterBar row — the wrapping facet/value chips (each h-8). */}
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="filter-bar"
          >
            {FILTER_CHIPS.map((chip) =>
              chip.key === "labels" ? (
                <div
                  key={chip.key}
                  className="relative inline-block max-w-full"
                >
                  <StaticLabelInput
                    label={chipLabels[chip.key]}
                    className={chip.width}
                  />
                </div>
              ) : (
                <div
                  key={chip.key}
                  className={
                    chip.field
                      ? "relative inline-block max-w-full"
                      : "inline-block"
                  }
                >
                  <StaticFilterControl
                    label={chipLabels[chip.key]}
                    field={chip.field}
                    dataKey={chip.key}
                    icon={
                      chip.key === "sort"
                        ? ListOrdered
                        : chip.key === "updatedAtRange"
                          ? CalendarIcon
                          : undefined
                    }
                    className={chip.width}
                  />
                </div>
              ),
            )}
          </div>
        </div>
        <BoardColumnsSkeleton />
      </div>
    </div>
  );
}
