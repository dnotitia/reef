import {
  ISSUE_TYPE_LABELS,
  NO_SELECTION,
  SEVERITY_LABELS,
} from "@/components/fields/fieldKit";
import {
  ExternalRefs,
  LabelChips,
  Muted,
  PlainValue,
  RelationIds,
} from "@/components/fields/fieldValue";
import { PriorityBadge } from "@/components/ui/priority-dot";
import type { PrioritySelection } from "@/features/issues/lib/issueDraftForm";
import type {
  EnrichmentField,
  EnrichmentSuggestion,
  ExternalRef,
  IssueType,
  Severity,
} from "@reef/core";
import type { ReactNode } from "react";

/**
 * Live snapshot of the New Issue form plus its setters. The descriptor map
 * below is the just place that reads `values` for display and the just place
 * that calls a setter to apply a suggestion — adding/removing an enrichment
 * field is a one-line edit to `FIELD_DESCRIPTORS`.
 */
export interface EnrichmentFormValues {
  readonly title: string;
  readonly content: string;
  readonly issueType: IssueType;
  readonly priority: PrioritySelection;
  readonly assignee: string;
  readonly requester: string;
  readonly reporter: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly milestoneId: string;
  readonly sprintId: string;
  readonly releaseId: string;
  readonly estimatePoints: string;
  readonly severity: Severity | "";
  readonly parentId: string;
  readonly labels: readonly string[];
  readonly dependsOn: readonly string[];
  readonly blocks: readonly string[];
  readonly relatedTo: readonly string[];
  readonly externalRefs: readonly ExternalRef[];
}

export interface EnrichmentFormApi {
  readonly values: EnrichmentFormValues;
  setTitle: (value: string) => void;
  setBody: (value: string) => void;
  setIssueType: (value: IssueType) => void;
  setPriority: (value: PrioritySelection) => void;
  setAssignee: (value: string) => void;
  setRequester: (value: string) => void;
  setReporter: (value: string) => void;
  setStartDate: (value: string) => void;
  setDueDate: (value: string) => void;
  setMilestoneId: (value: string) => void;
  setSprintId: (value: string) => void;
  setReleaseId: (value: string) => void;
  setEstimatePoints: (value: string) => void;
  setSeverity: (value: Severity | "") => void;
  setParentId: (value: string) => void;
  setLabels: (value: string[]) => void;
  setDependsOn: (value: string[]) => void;
  setBlocks: (value: string[]) => void;
  setRelatedTo: (value: string[]) => void;
  setExternalRefs: (value: ExternalRef[]) => void;
}

/** Narrow the suggestion union to the member targeting field `F`. */
type SuggestionFor<F extends EnrichmentField> = Extract<
  EnrichmentSuggestion,
  { field: F }
>;

export interface FieldDescriptor<F extends EnrichmentField> {
  readonly label: string;
  /** Current form value, formatted for the inline "before" slot. */
  formatCurrent: (form: EnrichmentFormApi) => ReactNode;
  /** Suggested value, formatted for the inline "after" slot. */
  formatSuggested: (suggestion: SuggestionFor<F>) => ReactNode;
  /** Write the suggestion into form state — the just place a setter runs. */
  apply: (form: EnrichmentFormApi, suggestion: SuggestionFor<F>) => void;
}

type FieldDescriptorMap = {
  readonly [F in EnrichmentField]: FieldDescriptor<F>;
};

/**
 * Single canonical source for enrichment field behavior. The mapped type
 * `{ [F in EnrichmentField]: FieldDescriptor<F> }` makes this exhaustive at
 * compile time (omit a field → type error) and ties each entry's `suggestion`
 * payload to the right union member, so `suggestion.value` is correctly typed
 * per field with no casts inside the entries.
 */
export const FIELD_DESCRIPTORS: FieldDescriptorMap = {
  title: {
    label: "Title",
    formatCurrent: (f) =>
      f.values.title ? (
        <PlainValue>{f.values.title}</PlainValue>
      ) : (
        <Muted>Empty</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setTitle(s.value),
  },
  content: {
    label: "Description",
    formatCurrent: (f) =>
      f.values.content ? (
        <PlainValue>{f.values.content}</PlainValue>
      ) : (
        <Muted>Empty</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setBody(s.value),
  },
  issue_type: {
    label: "Type",
    formatCurrent: (f) => (
      <PlainValue>{ISSUE_TYPE_LABELS[f.values.issueType]}</PlainValue>
    ),
    formatSuggested: (s) => (
      <PlainValue>{ISSUE_TYPE_LABELS[s.value]}</PlainValue>
    ),
    apply: (f, s) => f.setIssueType(s.value),
  },
  priority: {
    label: "Priority",
    formatCurrent: (f) =>
      f.values.priority === NO_SELECTION ? (
        <Muted>No priority</Muted>
      ) : (
        <PriorityBadge priority={f.values.priority} />
      ),
    formatSuggested: (s) => <PriorityBadge priority={s.value} />,
    apply: (f, s) => f.setPriority(s.value),
  },
  assigned_to: {
    label: "Assignee",
    formatCurrent: (f) =>
      f.values.assignee ? (
        <PlainValue>{f.values.assignee}</PlainValue>
      ) : (
        <Muted>Unassigned</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setAssignee(s.value),
  },
  requester: {
    label: "Requester",
    formatCurrent: (f) =>
      f.values.requester ? (
        <PlainValue>{f.values.requester}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setRequester(s.value),
  },
  reporter: {
    label: "Reporter",
    formatCurrent: (f) =>
      f.values.reporter ? (
        <PlainValue>{f.values.reporter}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setReporter(s.value),
  },
  start_date: {
    label: "Start",
    formatCurrent: (f) =>
      f.values.startDate ? (
        <PlainValue>{f.values.startDate}</PlainValue>
      ) : (
        <Muted>Not set</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value.slice(0, 10)}</PlainValue>,
    apply: (f, s) => f.setStartDate(s.value.slice(0, 10)),
  },
  due_date: {
    label: "Due",
    formatCurrent: (f) =>
      f.values.dueDate ? (
        <PlainValue>{f.values.dueDate}</PlainValue>
      ) : (
        <Muted>Not set</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value.slice(0, 10)}</PlainValue>,
    apply: (f, s) => f.setDueDate(s.value.slice(0, 10)),
  },
  milestone_id: {
    label: "Milestone",
    formatCurrent: (f) =>
      f.values.milestoneId ? (
        <PlainValue>{f.values.milestoneId}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setMilestoneId(s.value),
  },
  sprint_id: {
    label: "Sprint",
    formatCurrent: (f) =>
      f.values.sprintId ? (
        <PlainValue>{f.values.sprintId}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setSprintId(s.value),
  },
  release_id: {
    label: "Release",
    formatCurrent: (f) =>
      f.values.releaseId ? (
        <PlainValue>{f.values.releaseId}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setReleaseId(s.value),
  },
  estimate_points: {
    label: "Points",
    formatCurrent: (f) =>
      f.values.estimatePoints ? (
        <PlainValue>{f.values.estimatePoints}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{String(s.value)}</PlainValue>,
    apply: (f, s) => f.setEstimatePoints(String(s.value)),
  },
  severity: {
    label: "Severity",
    formatCurrent: (f) =>
      f.values.severity ? (
        <PlainValue>{SEVERITY_LABELS[f.values.severity]}</PlainValue>
      ) : (
        <Muted>No severity</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{SEVERITY_LABELS[s.value]}</PlainValue>,
    apply: (f, s) => f.setSeverity(s.value),
  },
  parent_id: {
    label: "Parent",
    formatCurrent: (f) =>
      f.values.parentId ? (
        <PlainValue>{f.values.parentId}</PlainValue>
      ) : (
        <Muted>None</Muted>
      ),
    formatSuggested: (s) => <PlainValue>{s.value}</PlainValue>,
    apply: (f, s) => f.setParentId(s.value),
  },
  labels: {
    label: "Labels",
    formatCurrent: (f) => <LabelChips labels={f.values.labels} />,
    formatSuggested: (s) => <LabelChips labels={s.value} />,
    apply: (f, s) => f.setLabels(s.value),
  },
  depends_on: {
    label: "Depends on",
    formatCurrent: (f) => <RelationIds ids={f.values.dependsOn} />,
    formatSuggested: (s) => <RelationIds ids={s.value} />,
    apply: (f, s) => f.setDependsOn(s.value),
  },
  blocks: {
    label: "Blocks",
    formatCurrent: (f) => <RelationIds ids={f.values.blocks} />,
    formatSuggested: (s) => <RelationIds ids={s.value} />,
    apply: (f, s) => f.setBlocks(s.value),
  },
  related_to: {
    label: "Related",
    formatCurrent: (f) => <RelationIds ids={f.values.relatedTo} />,
    formatSuggested: (s) => <RelationIds ids={s.value} />,
    apply: (f, s) => f.setRelatedTo(s.value),
  },
  external_refs: {
    label: "External references",
    formatCurrent: (f) => <ExternalRefs refs={f.values.externalRefs} />,
    formatSuggested: (s) => <ExternalRefs refs={s.value} />,
    apply: (f, s) => f.setExternalRefs(s.value),
  },
};

// ── Correlated-union accessors ──────────────────────────────────────────────
// Indexing FIELD_DESCRIPTORS by a runtime `field` does not be statically
// correlated with a `suggestion` of the full union, so we assert the entry's
// signature to the union form. This is sound: `suggestion.field` selects the
// matching descriptor, so the value consistently matches the entry's expected member.

export function fieldLabel(field: EnrichmentField): string {
  return FIELD_DESCRIPTORS[field].label;
}

export function formatCurrentValue(
  form: EnrichmentFormApi,
  field: EnrichmentField,
): ReactNode {
  return FIELD_DESCRIPTORS[field].formatCurrent(form);
}

export function formatSuggestedValue(
  suggestion: EnrichmentSuggestion,
): ReactNode {
  const format = FIELD_DESCRIPTORS[suggestion.field].formatSuggested as (
    s: EnrichmentSuggestion,
  ) => ReactNode;
  return format(suggestion);
}

export function applySuggestionToForm(
  form: EnrichmentFormApi,
  suggestion: EnrichmentSuggestion,
): void {
  const apply = FIELD_DESCRIPTORS[suggestion.field].apply as (
    f: EnrichmentFormApi,
    s: EnrichmentSuggestion,
  ) => void;
  apply(form, suggestion);
}
