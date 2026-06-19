"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { DependencyBadge } from "@/components/fields/DependencyBadge";
import { DueBadge } from "@/components/fields/DueBadge";
import { SeverityBadge } from "@/components/fields/SeverityBadge";
import { TypePill } from "@/components/fields/TypePill";
import { DEPENDENCY_OPTIONS, DUE_OPTIONS } from "@/components/fields/fieldKit";
import type { ComboboxOption } from "@/components/ui/combobox";
import { CBX_TRIGGER_ACTIVE } from "@/components/ui/comboboxChrome";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { PRIORITY_OPTIONS, PriorityBadge } from "@/components/ui/priority-dot";
import { STATUS_OPTIONS, StatusBadge } from "@/components/ui/status-icon";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { Archive, CircleCheck, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { formatLabelFilter, parseLabelFilter } from "../../lib/issueListUtils";
import {
  ISSUE_TYPE_OPTIONS,
  SEVERITY_OPTIONS,
} from "../../lib/metadataOptions";
import { type IssueFilter, useIssueStore } from "../../stores/useIssueStore";

/**
 * The Assignee/Requester filter triggers stay narrow — they hug their value from
 * a compact `9rem` floor (`FILTER_FIELD_CLASS`) — but their open user dropdown
 * needs room to show a long display name and its `@login` together, which a
 * floor-width trigger truncates. Floor the *opened* panel at a readable width and
 * cap it to the viewport so it can not be excessively clipped when the filter bar
 * wraps onto multiple rows (REEF-134/269).
 *
 * The user filters pass `align="start"` (see below) to match the sibling
 * planning filters in this bar: a panel wider than its trigger then
 * grows rightward, keeping the realistic left-edge wrap case on-screen. A panel
 * wider than its trigger can still overflow whichever edge it grows toward when
 * the trigger lands at the far end of a wrapped row — true of every non-portaled
 * combobox here (the planning filters included). Eliminating that entirely needs
 * collision-aware positioning in the shared Combobox/popover primitive, which is
 * intentionally simple (REEF-073/092) and out of scope for this fix; `max-w-[90vw]`
 * bounds the worst case in the meantime.
 */
export const USER_FILTER_PANEL_CLASS = "min-w-[17rem] max-w-[90vw]";

/**
 * Shared width policy for the bar's "value field" comboboxes — Assignee,
 * Requester, Sprint, Milestone, Release, and Labels. One token so the whole
 * value-field group sizes identically: hug the selected value (`w-fit`), floored
 * at `9rem` — the old `w-36` people-trigger width — so an empty field still reads
 * as a field, and capped at `16rem` so a long value truncates instead of pushing
 * the bar wide. This converges REEF-134 (people triggers pinned compact at a
 * fixed `w-36`) and REEF-246 (planning triggers already fit-content, but capped
 * at a wider `22rem`) onto a single vocabulary: every value field now grows with
 * its value up to the same cap. The people triggers gaining hug behavior is the
 * intended change REEF-246 deferred under its "Ask First" (REEF-269).
 *
 * Two pieces stay deliberately separate:
 * - The OPEN user dropdown panel keeps its own readable floor via
 *   `USER_FILTER_PANEL_CLASS` — REEF-134's compact-trigger / wide-panel split is
 *   preserved; only the closed trigger's width policy is unified here.
 * - The multi-select facet "chips" (Status, Type, Priority, Severity, Due,
 *   Dependency) stay auto-width via `CBX_TRIGGER_CHIP` (`inline-flex`, no `w-full`
 *   and no width token). That hug-the-label chip vocabulary is a separate,
 *   intended one and is NOT given this class.
 */
export const FILTER_FIELD_CLASS = "w-fit min-w-[9rem] max-w-[16rem]";

/**
 * Wrapper for the planning value fields. The width token lives on the inner
 * combobox (`FILTER_FIELD_CLASS`, passed as its `className`), matching REEF-246;
 * this wrapper only provides the relative box and a viewport cap so the field can
 * wrap without overflowing the bar.
 */
export const PLANNING_FILTER_WRAPPER_CLASS = "relative inline-block max-w-full";

/**
 * The "Display" view-mode toggles (REEF-275), modeled as a multi-select facet so
 * they reuse the exact same `MultiSelectCombobox` chrome (panel, glyph+label row,
 * trailing brand Check, chip trigger) as every sibling facet in this bar — rather
 * than a bespoke popover. Each toggle maps to one boolean filter flag (`archived`
 * → `showArchived`, `completed` → `showStale`); "selected" means the flag is on.
 * Glyph-aligned with the facet rows; the primitive adds the trailing selection
 * Check itself, so the leading glyph is the value mark only.
 */
type ViewModeKey = "archived" | "completed";

const VIEW_MODE_OPTIONS: ComboboxOption<ViewModeKey>[] = [
  {
    value: "archived",
    label: "Show archived",
    content: (
      <>
        <Archive
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        Show archived
      </>
    ),
    testId: "show-archived-toggle",
  },
  {
    value: "completed",
    label: "Show completed",
    content: (
      <>
        <CircleCheck
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        Show completed
      </>
    ),
    testId: "show-stale-toggle",
  },
];

/**
 * Static multi-select facet option lists. Hoisted to module scope so the badge
 * elements aren't re-created on every render; the just dynamic facet is Status,
 * whose offered values depend on the `statusOptions` prop (board/timeline pass
 * the workflow set), so it is built inside the component. Each option's
 * `testId` preserves the `{facet}-option-{value}` contract the filter tests use.
 */
const TYPE_FACET_OPTIONS: ComboboxOption<
  (typeof ISSUE_TYPE_OPTIONS)[number]
>[] = ISSUE_TYPE_OPTIONS.map((type) => ({
  value: type,
  label: type,
  content: <TypePill type={type} variant="badge" />,
  testId: `type-option-${type}`,
}));

const PRIORITY_FACET_OPTIONS: ComboboxOption<
  (typeof PRIORITY_OPTIONS)[number]
>[] = PRIORITY_OPTIONS.map((priority) => ({
  value: priority,
  label: priority,
  content: <PriorityBadge priority={priority} />,
  testId: `priority-option-${priority}`,
}));

const SEVERITY_FACET_OPTIONS: ComboboxOption<
  (typeof SEVERITY_OPTIONS)[number]
>[] = SEVERITY_OPTIONS.map((severity) => ({
  value: severity,
  label: severity,
  content: <SeverityBadge severity={severity} />,
  testId: `severity-option-${severity}`,
}));

const DUE_FACET_OPTIONS: ComboboxOption<(typeof DUE_OPTIONS)[number]>[] =
  DUE_OPTIONS.map((value) => ({
    value,
    label: value,
    content: <DueBadge due={value} />,
    testId: `due-option-${value}`,
  }));

const DEPENDENCY_FACET_OPTIONS: ComboboxOption<
  (typeof DEPENDENCY_OPTIONS)[number]
>[] = DEPENDENCY_OPTIONS.map((value) => ({
  value,
  label: value,
  content: <DependencyBadge dependency={value} />,
  testId: `dependency-option-${value}`,
}));

/**
 * Toggle a value within a multi-select facet (REEF-031). Returns the new array,
 * or `undefined` when the selection becomes empty — facets are not stored as
 * an empty array (keeps truthy `?.length` checks and the persisted/URL
 * projections consistent). The MultiSelectCombobox primitive reports each toggle
 * and stays agnostic of this folding rule (REEF-140).
 */
function toggleFacet<T extends string>(
  current: readonly T[] | undefined,
  value: T,
  checked: boolean,
): T[] | undefined {
  const selected = current ?? [];
  const next = checked
    ? [...selected, value]
    : selected.filter((v) => v !== value);
  return next.length > 0 ? next : undefined;
}

/** Count how many filter fields are actively set. In the backlog view the bar
 *  drops the facets that the view pins or does not partition on (Status, Sprint,
 *  Release, Due — see `backlogScope` below), and the backlog query neutralizes
 *  those same values, so a stray saved/shared value for them is ignored here and
 *  should not inflate the count or surface a clear button for a control the user
 *  does not see (REEF-109/177). The kept triage facets consistently count. */
function countActiveFilters(
  filter: IssueFilter,
  backlogScope: boolean,
): number {
  let count = 0;
  if (!backlogScope && filter.status?.length) count++;
  if (filter.issueType?.length) count++;
  if (filter.priority?.length) count++;
  if (filter.assignee?.trim()) count++;
  if (filter.requester?.trim()) count++;
  if (!backlogScope && filter.sprint_id) count++;
  if (filter.milestone_id) count++;
  if (!backlogScope && filter.release_id) count++;
  if (filter.severity?.length) count++;
  if (!backlogScope && filter.due?.length) count++;
  if (filter.label?.trim()) count++;
  if (filter.dependencyFilter?.length) count++;
  return count;
}

interface FilterBarProps {
  /**
   * Render the backlog view's reduced facet set. The backlog is pinned to the
   * `backlog` status, so a Status facet is meaningless there (REEF-109); and an
   * item that is in a sprint or release is by definition committed (so a backlog
   * row does not matches one → an consistently-empty result), while the backlog view
   * discards its Due column and a due date on an uncommitted item is
   * contradictory — so the Sprint, Release, and Due facets are dropped too
   * (REEF-177). Milestone and the remaining triage facets (type/priority/
   * severity/dependency/assignee/requester/labels) stay: a milestone is a
   * long-horizon theme that legitimately groups unscheduled backlog work, and
   * the rest are real triage axes. The backlog query neutralizes the dropped
   * facets' stored values to match (`BacklogView`), so a value carried over from
   * list/board does not silently filter here.
   */
  backlogScope?: boolean;
  /**
   * The status values offered in the Status facet. Defaults to every status.
   * Board and timeline pass `WORKFLOW_STATUS_OPTIONS` so they does not offer
   * `backlog` — a status those views group away, which would otherwise filter to
   * an empty board with an active facet (REEF-109). The list can render backlog
   * rows, so it keeps the full set.
   */
  statusOptions?: readonly Status[];
}

export function FilterBar({
  backlogScope = false,
  statusOptions = STATUS_OPTIONS,
}: FilterBarProps) {
  const filter = useIssueStore((state) => state.filter);
  const setFilter = useIssueStore((state) => state.setFilter);
  const clearFiltersOnly = useIssueStore((state) => state.clearFiltersOnly);
  const { vault } = useActiveVault();

  const labelValues = useMemo(
    () => parseLabelFilter(filter.label),
    [filter.label],
  );

  const statusFacetOptions = useMemo<ComboboxOption<Status>[]>(
    () =>
      statusOptions.map((s) => ({
        value: s,
        label: s,
        content: <StatusBadge status={s} />,
        testId: `status-option-${s}`,
      })),
    [statusOptions],
  );

  const handleLabelsChange = useCallback(
    (labels: string[]) => {
      setFilter({ label: formatLabelFilter(labels) });
    },
    [setFilter],
  );

  const activeCount = countActiveFilters(filter, backlogScope);
  const hasActiveFilters = activeCount > 0;

  // The two view-mode flags projected into the multi-select facet's value array
  // ("selected" = flag on). The backlog scope drops the resolved-only "completed"
  // toggle, mirroring how the facets above drop status/sprint/etc. there.
  const viewModeValues: ViewModeKey[] = [];
  if (filter.showArchived) viewModeValues.push("archived");
  if (filter.showStale) viewModeValues.push("completed");
  const viewModeOptions = backlogScope
    ? VIEW_MODE_OPTIONS.slice(0, 1)
    : VIEW_MODE_OPTIONS;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filter-bar">
      {/* Status filter — omitted in the backlog view, which pins status itself */}
      {backlogScope ? null : (
        <MultiSelectCombobox
          label="Status"
          values={filter.status}
          onToggle={(value, checked) =>
            setFilter({ status: toggleFacet(filter.status, value, checked) })
          }
          options={statusFacetOptions}
          active={Boolean(filter.status?.length)}
          ariaLabel="Status"
          triggerTestId="status-dropdown-trigger"
          contentTestId="status-dropdown-content"
        />
      )}

      {/* Type filter */}
      <MultiSelectCombobox
        label="Type"
        values={filter.issueType}
        onToggle={(value, checked) =>
          setFilter({
            issueType: toggleFacet(filter.issueType, value, checked),
          })
        }
        options={TYPE_FACET_OPTIONS}
        active={Boolean(filter.issueType?.length)}
        ariaLabel="Type"
        triggerTestId="type-dropdown-trigger"
        contentTestId="type-dropdown-content"
      />

      {/* Priority filter */}
      <MultiSelectCombobox
        label="Priority"
        values={filter.priority}
        onToggle={(value, checked) =>
          setFilter({ priority: toggleFacet(filter.priority, value, checked) })
        }
        options={PRIORITY_FACET_OPTIONS}
        active={Boolean(filter.priority?.length)}
        ariaLabel="Priority"
        triggerTestId="priority-dropdown-trigger"
        contentTestId="priority-dropdown-content"
      />

      {/* Severity filter */}
      <MultiSelectCombobox
        label="Severity"
        values={filter.severity}
        onToggle={(value, checked) =>
          setFilter({ severity: toggleFacet(filter.severity, value, checked) })
        }
        options={SEVERITY_FACET_OPTIONS}
        active={Boolean(filter.severity?.length)}
        ariaLabel="Severity"
        triggerTestId="severity-dropdown-trigger"
        contentTestId="severity-dropdown-content"
      />

      {/* Due filter — dropped in the backlog view: that view discards its Due
          column and a due date on an uncommitted item is contradictory
          (REEF-177). */}
      {backlogScope ? null : (
        <MultiSelectCombobox
          label="Due"
          values={filter.due}
          onToggle={(value, checked) =>
            setFilter({ due: toggleFacet(filter.due, value, checked) })
          }
          options={DUE_FACET_OPTIONS}
          active={Boolean(filter.due?.length)}
          ariaLabel="Due"
          triggerTestId="due-dropdown-trigger"
          contentTestId="due-dropdown-content"
        />
      )}

      {/* Dependency filter */}
      <MultiSelectCombobox
        label="Dependency"
        values={filter.dependencyFilter}
        onToggle={(value, checked) =>
          setFilter({
            dependencyFilter: toggleFacet(
              filter.dependencyFilter,
              value,
              checked,
            ),
          })
        }
        options={DEPENDENCY_FACET_OPTIONS}
        active={Boolean(filter.dependencyFilter?.length)}
        ariaLabel="Dependency"
        triggerTestId="dependency-dropdown-trigger"
        contentTestId="dependency-dropdown-content"
      />

      {/* Assignee filter */}
      <div
        className={cn("relative", FILTER_FIELD_CLASS)}
        data-testid="assignee-filter"
      >
        <AssigneeCombobox
          value={filter.assignee ?? ""}
          onChange={(login) => setFilter({ assignee: login || undefined })}
          vault={vault}
          label="Assignee"
          placeholder="Assignee"
          emptyLabel="Any assignee"
          active={Boolean(filter.assignee?.trim())}
          panelClassName={USER_FILTER_PANEL_CLASS}
          align="start"
        />
      </div>

      {/* Requester filter */}
      <div
        className={cn("relative", FILTER_FIELD_CLASS)}
        data-testid="requester-filter"
      >
        <AssigneeCombobox
          value={filter.requester ?? ""}
          onChange={(login) => setFilter({ requester: login || undefined })}
          vault={vault}
          label="Requester"
          placeholder="Requester"
          emptyLabel="Any requester"
          active={Boolean(filter.requester?.trim())}
          panelClassName={USER_FILTER_PANEL_CLASS}
          align="start"
        />
      </div>

      {/* Sprint filter — dropped in the backlog view: a sprinted item is
          committed, so it can not be in the backlog (REEF-177). */}
      {backlogScope ? null : (
        <div
          className={PLANNING_FILTER_WRAPPER_CLASS}
          data-testid="sprint-filter"
        >
          <PlanningItemCombobox
            kind="sprints"
            vault={vault}
            value={filter.sprint_id ?? ""}
            onChange={(id) => setFilter({ sprint_id: id || undefined })}
            label="Sprint"
            placeholder="Sprint"
            emptyLabel="Any sprint"
            testId="sprint-input"
            active={Boolean(filter.sprint_id)}
            className={FILTER_FIELD_CLASS}
          />
        </div>
      )}

      {/* Milestone filter — kept in the backlog view: a milestone is a
          long-horizon theme that legitimately groups unscheduled backlog work
          (REEF-177). */}
      <div
        className={PLANNING_FILTER_WRAPPER_CLASS}
        data-testid="milestone-filter"
      >
        <PlanningItemCombobox
          kind="milestones"
          vault={vault}
          value={filter.milestone_id ?? ""}
          onChange={(id) => setFilter({ milestone_id: id || undefined })}
          label="Milestone"
          placeholder="Milestone"
          emptyLabel="Any milestone"
          active={Boolean(filter.milestone_id)}
          className={FILTER_FIELD_CLASS}
        />
      </div>

      {/* Release filter — dropped in the backlog view: a released item is
          committed, so it can not be in the backlog (REEF-177). */}
      {backlogScope ? null : (
        <div
          className={PLANNING_FILTER_WRAPPER_CLASS}
          data-testid="release-filter"
        >
          <PlanningItemCombobox
            kind="releases"
            vault={vault}
            value={filter.release_id ?? ""}
            onChange={(id) => setFilter({ release_id: id || undefined })}
            label="Release"
            placeholder="Release"
            emptyLabel="Any release"
            active={Boolean(filter.release_id)}
            className={FILTER_FIELD_CLASS}
          />
        </div>
      )}

      {/* Labels filter */}
      <div
        className={cn("relative", FILTER_FIELD_CLASS)}
        data-testid="labels-filter"
      >
        <LabelChipInput
          value={labelValues}
          onChange={handleLabelsChange}
          placeholder="Labels"
          data-testid="labels-input"
          // Unlike the combobox value fields — whose closed trigger shows a short
          // placeholder so they rest at the shared `9rem` floor — the chip input's
          // text field carries a browser-default ~20ch intrinsic width that would
          // push this `w-fit` wrapper past the floor and break the empty-state
          // alignment. Zero the input's width basis so it flexes to fill the
          // floored field instead of dictating it; the field still hugs upward as
          // chips accumulate, up to the shared `16rem` cap (REEF-269).
          className={cn(
            "min-h-8 py-1 [&_input]:w-0",
            filter.label?.trim() && CBX_TRIGGER_ACTIVE,
          )}
        />
      </div>

      {/* Display options — the "view mode" toggles (what shows up): Show archived
          + Show completed. Reuses the same MultiSelectCombobox as every facet
          above (identical panel/row/check/chip chrome) instead of a bespoke
          popover; kept apart from the active-filter counter since these widen
          rather than narrow the set, and placed at the end so they do not shift
          focus order for users who never touch them (REEF-275). */}
      <MultiSelectCombobox
        label="Display"
        values={viewModeValues}
        onToggle={(value, checked) =>
          setFilter(
            value === "archived"
              ? { showArchived: checked || undefined }
              : { showStale: checked || undefined },
          )
        }
        options={viewModeOptions}
        active={Boolean(filter.showArchived || filter.showStale)}
        ariaLabel="Display options"
        triggerTestId="display-options-trigger"
        contentTestId="display-options-content"
      />

      {/* Active filter count + clear */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-foreground/80"
            data-testid="active-filter-count"
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-brand"
              aria-hidden="true"
            />
            {activeCount} filter{activeCount !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
            onClick={() => {
              clearFiltersOnly();
            }}
            data-testid="clear-filters-button"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
