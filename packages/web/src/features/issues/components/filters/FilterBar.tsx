"use client";

import { MultiAssigneeCombobox } from "@/components/MultiAssigneeCombobox";
import { DependencyBadge } from "@/components/fields/DependencyBadge";
import { DueBadge } from "@/components/fields/DueBadge";
import { SeverityBadge } from "@/components/fields/SeverityBadge";
import { TypePill } from "@/components/fields/TypePill";
import { DEPENDENCY_OPTIONS, DUE_OPTIONS } from "@/components/fields/fieldKit";
import type { ComboboxOption } from "@/components/ui/combobox";
import { CBX_TRIGGER_ACTIVE } from "@/components/ui/comboboxChrome";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import { PlanningItemMultiCombobox } from "@/features/planning/components/PlanningItemMultiCombobox";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  useDependencyLabels,
  useDueLabels,
  useFieldNameLabels,
  useIssueTypeLabels,
  usePriorityLabels,
  useSeverityLabels,
  useStatusLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { PRIORITY_OPTIONS } from "@reef/core/fields";
import { STATUS_OPTIONS } from "@reef/core/fields";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { formatLabelFilter, parseLabelFilter } from "../../lib/issueListUtils";
import {
  ISSUE_TYPE_OPTIONS,
  SEVERITY_OPTIONS,
} from "../../lib/metadataOptions";
import { type IssueFilter, useIssueStore } from "../../stores/useIssueStore";
import { DisplayOptionsFilter } from "./DisplayOptionsFilter";

/**
 * The Assignee/Requester filters are now multi-select chip triggers (REEF-267),
 * so their closed trigger is the auto-width "(N)" facet chip like every other
 * facet — but their open dropdown still needs room to show a long display name
 * and its `@login` together, which a narrow panel truncates. Floor the *opened*
 * panel at a readable width and cap it to the viewport so it can not be
 * excessively clipped when the filter bar wraps onto multiple rows (REEF-134/269).
 *
 * The panel can still overflow whichever edge it grows toward when the trigger
 * lands at the far end of a wrapped row — true of every non-portaled combobox
 * here. Eliminating that entirely needs collision-aware positioning in the
 * shared Combobox/popover primitive, which is intentionally simple (REEF-073/092)
 * and out of scope; `max-w-[90vw]` bounds the worst case in the meantime.
 */
export const USER_FILTER_PANEL_CLASS = "min-w-[17rem] max-w-[90vw]";

/**
 * Shared width policy for the bar's remaining "value field" comboboxes —
 * Milestone and Labels. One token so they size identically: hug the selected
 * value (`w-fit`), floored at `9rem` so an empty field still reads as a field,
 * and capped at `16rem` so a long value truncates instead of pushing the bar
 * wide (REEF-269).
 *
 * REEF-267 moved Assignee / Requester / Sprint / Release off this value-field
 * vocabulary onto the auto-width multi-select chip (alongside Status / Type /
 * Priority / Severity / Due / Dependency, all via `CBX_TRIGGER_CHIP`); Milestone
 * stays a single-select value field because it was deliberately left
 * single-cardinality (REEF-267 Scope).
 */
export const FILTER_FIELD_CLASS = "w-fit min-w-[9rem] max-w-[16rem]";

/**
 * Wrapper for the single-select Milestone value field. The width token lives on
 * the inner combobox (`FILTER_FIELD_CLASS`, passed as its `className`), matching
 * REEF-246; this wrapper provides the relative box and a viewport cap so the
 * field can wrap without overflowing the bar.
 */
export const PLANNING_FILTER_WRAPPER_CLASS = "relative inline-block max-w-full";

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
  if (filter.assignee?.length) count++;
  if (filter.requester?.length) count++;
  if (!backlogScope && filter.sprint_id?.length) count++;
  if (filter.milestone_id) count++;
  if (!backlogScope && filter.release_id?.length) count++;
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

  // Locale-resolved labels for the single-selection chip summary (REEF-292).
  // The dropdown rows already render localized badge content; these make the
  // closed trigger read "Status (할 일)" instead of the raw "Status (todo)".
  const statusLabels = useStatusLabels();
  const issueTypeLabels = useIssueTypeLabels();
  const priorityLabels = usePriorityLabels();
  const severityLabels = useSeverityLabels();
  const dueLabels = useDueLabels();
  const dependencyLabels = useDependencyLabels();
  // Field-NAME labels for the facet triggers' aria/label text (REEF-301), so the
  // facet name localizes alongside its already-localized value summary.
  const fieldNames = useFieldNameLabels();
  // Localized bar copy (REEF-298): the active-filter count, the milestone
  // empty-state label, and the shared "Clear filters" action.
  const t = useTranslations("issues.filters");
  const c = useTranslations("common");

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

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filter-bar">
      {/* Status filter — omitted in the backlog view, which pins status itself */}
      {backlogScope ? null : (
        <MultiSelectCombobox
          label={fieldNames.status}
          values={filter.status}
          onToggle={(value, checked) =>
            setFilter({ status: toggleFacet(filter.status, value, checked) })
          }
          options={statusFacetOptions}
          summarizeValue={(s) => statusLabels[s as keyof typeof statusLabels]}
          active={Boolean(filter.status?.length)}
          ariaLabel={fieldNames.status}
          triggerTestId="status-dropdown-trigger"
          contentTestId="status-dropdown-content"
        />
      )}

      {/* Type filter */}
      <MultiSelectCombobox
        label={fieldNames.type}
        values={filter.issueType}
        onToggle={(value, checked) =>
          setFilter({
            issueType: toggleFacet(filter.issueType, value, checked),
          })
        }
        options={TYPE_FACET_OPTIONS}
        summarizeValue={(t) =>
          issueTypeLabels[t as keyof typeof issueTypeLabels]
        }
        active={Boolean(filter.issueType?.length)}
        ariaLabel={fieldNames.type}
        triggerTestId="type-dropdown-trigger"
        contentTestId="type-dropdown-content"
      />

      {/* Priority filter */}
      <MultiSelectCombobox
        label={fieldNames.priority}
        values={filter.priority}
        onToggle={(value, checked) =>
          setFilter({ priority: toggleFacet(filter.priority, value, checked) })
        }
        options={PRIORITY_FACET_OPTIONS}
        summarizeValue={(p) => priorityLabels[p as keyof typeof priorityLabels]}
        active={Boolean(filter.priority?.length)}
        ariaLabel={fieldNames.priority}
        triggerTestId="priority-dropdown-trigger"
        contentTestId="priority-dropdown-content"
      />

      {/* Severity filter */}
      <MultiSelectCombobox
        label={fieldNames.severity}
        values={filter.severity}
        onToggle={(value, checked) =>
          setFilter({ severity: toggleFacet(filter.severity, value, checked) })
        }
        options={SEVERITY_FACET_OPTIONS}
        summarizeValue={(s) => severityLabels[s as keyof typeof severityLabels]}
        active={Boolean(filter.severity?.length)}
        ariaLabel={fieldNames.severity}
        triggerTestId="severity-dropdown-trigger"
        contentTestId="severity-dropdown-content"
      />

      {/* Due filter — dropped in the backlog view: that view discards its Due
          column and a due date on an uncommitted item is contradictory
          (REEF-177). */}
      {backlogScope ? null : (
        <MultiSelectCombobox
          label={fieldNames.due}
          values={filter.due}
          onToggle={(value, checked) =>
            setFilter({ due: toggleFacet(filter.due, value, checked) })
          }
          options={DUE_FACET_OPTIONS}
          summarizeValue={(d) => dueLabels[d as keyof typeof dueLabels]}
          active={Boolean(filter.due?.length)}
          ariaLabel={fieldNames.due}
          triggerTestId="due-dropdown-trigger"
          contentTestId="due-dropdown-content"
        />
      )}

      {/* Dependency filter */}
      <MultiSelectCombobox
        label={fieldNames.dependency}
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
        summarizeValue={(d) =>
          dependencyLabels[d as keyof typeof dependencyLabels]
        }
        active={Boolean(filter.dependencyFilter?.length)}
        ariaLabel={fieldNames.dependency}
        triggerTestId="dependency-dropdown-trigger"
        contentTestId="dependency-dropdown-content"
      />

      {/* Assignee filter — multi-select (REEF-267): a chip trigger like the
          facets above, OR-combining the picked logins. */}
      <div data-testid="assignee-filter">
        <MultiAssigneeCombobox
          values={filter.assignee}
          onToggle={(login, checked) =>
            setFilter({
              assignee: toggleFacet(filter.assignee, login, checked),
            })
          }
          vault={vault}
          label={fieldNames.assignee}
          active={Boolean(filter.assignee?.length)}
          triggerTestId="assignee-dropdown-trigger"
          contentTestId="assignee-dropdown-content"
          panelClassName={USER_FILTER_PANEL_CLASS}
        />
      </div>

      {/* Requester filter — multi-select (REEF-267). */}
      <div data-testid="requester-filter">
        <MultiAssigneeCombobox
          values={filter.requester}
          onToggle={(login, checked) =>
            setFilter({
              requester: toggleFacet(filter.requester, login, checked),
            })
          }
          vault={vault}
          label={fieldNames.requester}
          active={Boolean(filter.requester?.length)}
          triggerTestId="requester-dropdown-trigger"
          contentTestId="requester-dropdown-content"
          panelClassName={USER_FILTER_PANEL_CLASS}
        />
      </div>

      {/* Sprint filter — multi-select (REEF-267). Dropped in the backlog view:
          a sprinted item is committed, so it can not be in the backlog
          (REEF-177). */}
      {backlogScope ? null : (
        <div data-testid="sprint-filter">
          <PlanningItemMultiCombobox
            kind="sprints"
            vault={vault}
            values={filter.sprint_id}
            onToggle={(id, checked) =>
              setFilter({
                sprint_id: toggleFacet(filter.sprint_id, id, checked),
              })
            }
            label={fieldNames.sprint}
            active={Boolean(filter.sprint_id?.length)}
            triggerTestId="sprint-dropdown-trigger"
            contentTestId="sprint-dropdown-content"
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
          label={fieldNames.milestone}
          placeholder={fieldNames.milestone}
          emptyLabel={t("anyMilestone")}
          active={Boolean(filter.milestone_id)}
          className={FILTER_FIELD_CLASS}
        />
      </div>

      {/* Release filter — multi-select (REEF-267). Dropped in the backlog view:
          a released item is committed, so it can not be in the backlog
          (REEF-177). */}
      {backlogScope ? null : (
        <div data-testid="release-filter">
          <PlanningItemMultiCombobox
            kind="releases"
            vault={vault}
            values={filter.release_id}
            onToggle={(id, checked) =>
              setFilter({
                release_id: toggleFacet(filter.release_id, id, checked),
              })
            }
            label={fieldNames.release}
            active={Boolean(filter.release_id?.length)}
            triggerTestId="release-dropdown-trigger"
            contentTestId="release-dropdown-content"
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
          placeholder={fieldNames.labels}
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

      <DisplayOptionsFilter
        backlogScope={backlogScope}
        filter={filter}
        setFilter={setFilter}
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
            {t("activeCount", { count: activeCount })}
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
            {c("clearFilters")}
          </button>
        </div>
      )}
    </div>
  );
}
