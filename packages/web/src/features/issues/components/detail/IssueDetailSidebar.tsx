"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { DatePickerField } from "@/components/fields/DatePickerField";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { SeverityBadge } from "@/components/fields/SeverityBadge";
import { TypePill } from "@/components/fields/TypePill";
import { Input } from "@/components/ui/input";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import type {
  IssueListItem,
  IssueMetadata,
  IssueType,
  IssueUpdatePatch,
  Priority,
  Severity,
  Status,
} from "@reef/core";
import { PRIORITY_OPTIONS } from "@reef/core/fields";
import { STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import {
  ISSUE_TYPE_OPTIONS,
  NO_SELECTION,
  SEVERITY_OPTIONS,
} from "../../lib/metadataOptions";
import { buildStatusPatch } from "../../lib/statusPatch";
import { IssueRelationInput } from "../relations/IssueRelationInput";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { IssueFormSection } from "../shared/IssueFormSection";

const renderStatusOption = (s: Status) => <StatusBadge status={s} />;
const renderPriorityOption = (p: Priority) => <PriorityBadge priority={p} />;
const renderSeverityOption = (s: Severity) => <SeverityBadge severity={s} />;

const renderTypeOption = (t: IssueType) => (
  <TypePill type={t} variant="badge" />
);

type CommitTextField = <K extends keyof IssueUpdatePatch>(
  key: K,
  value: string,
  previous: string | null | undefined,
) => void;

type CommitNumberField = <K extends keyof IssueUpdatePatch>(
  key: K,
  value: string,
  previous: number | null | undefined,
) => void;

type ValueSetter<T> = (value: T) => void;

interface IssueDetailSidebarProps {
  vault: string;
  issueId: string;
  issue: IssueMetadata | undefined;
  allIssues: readonly IssueListItem[];
  relations: ComponentProps<typeof IssueRelationInput>["relationGraph"];
  issueType: IssueType;
  status: Status;
  priority: Priority | "";
  severity: Severity | "";
  labels: string[];
  assignee: string;
  requester: string;
  reporter: string;
  startDate: string;
  dueDate: string;
  sprintId: string;
  milestoneId: string;
  releaseId: string;
  estimatePoints: string;
  parentId: string;
  dependsOn: string[];
  blocks: string[];
  relatedTo: string[];
  setIssueType: ValueSetter<IssueType>;
  setStatus: ValueSetter<Status>;
  setPriority: ValueSetter<Priority | "">;
  setSeverity: ValueSetter<Severity | "">;
  setLabels: ValueSetter<string[]>;
  setAssignee: ValueSetter<string>;
  setRequester: ValueSetter<string>;
  setReporter: ValueSetter<string>;
  setStartDate: ValueSetter<string>;
  setDueDate: ValueSetter<string>;
  setSprintId: ValueSetter<string>;
  setMilestoneId: ValueSetter<string>;
  setReleaseId: ValueSetter<string>;
  setEstimatePoints: ValueSetter<string>;
  setParentId: ValueSetter<string>;
  setDependsOn: ValueSetter<string[]>;
  setBlocks: ValueSetter<string[]>;
  setRelatedTo: ValueSetter<string[]>;
  commit: (patch: IssueUpdatePatch) => void;
  commitTextField: CommitTextField;
  commitNumberField: CommitNumberField;
  commitSelectionField: CommitTextField;
  onClosedStatusRequested: () => void;
}

/** Order-sensitive equality so a reorder still counts as a change. */
function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function IssueDetailSidebar({
  vault,
  issueId,
  issue,
  allIssues,
  relations,
  issueType,
  status,
  priority,
  severity,
  labels,
  assignee,
  requester,
  reporter,
  startDate,
  dueDate,
  sprintId,
  milestoneId,
  releaseId,
  estimatePoints,
  parentId,
  dependsOn,
  blocks,
  relatedTo,
  setIssueType,
  setStatus,
  setPriority,
  setSeverity,
  setLabels,
  setAssignee,
  setRequester,
  setReporter,
  setStartDate,
  setDueDate,
  setSprintId,
  setMilestoneId,
  setReleaseId,
  setEstimatePoints,
  setParentId,
  setDependsOn,
  setBlocks,
  setRelatedTo,
  commit,
  commitTextField,
  commitNumberField,
  commitSelectionField,
  onClosedStatusRequested,
}: IssueDetailSidebarProps) {
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const s = useTranslations("sections");
  const c = useTranslations("common");
  const t = useTranslations("issues.detailSidebar");
  return (
    // Property-list rail (REEF-149): every scalar field is one `IssueFieldRow`
    // (fixed label + full-width value) instead of `grid-cols-2` half-cells, so
    // dates and planning-item names get the whole rail width. Below `lg` the
    // rail stacks under the main column and the divider flips `border-l` →
    // `border-t`.
    <aside
      data-testid="issue-detail-sidebar"
      className="flex min-w-0 flex-col gap-4 border-t border-border-subtle pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
    >
      <IssueFormSection title={s("details")}>
        <IssueFieldRow label={fieldNames.type} labelId="issue-type-label">
          <EnumSelectField
            value={issueType}
            onValueChange={(val) => {
              const next = val as IssueType;
              setIssueType(next);
              if (next !== issue?.issue_type) commit({ issue_type: next });
            }}
            options={ISSUE_TYPE_OPTIONS}
            renderItem={renderTypeOption}
            placeholder={fieldNames.type}
            testId="issue-type-select"
            ariaLabelledby="issue-type-label"
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.status} labelId="issue-status-label">
          <EnumSelectField
            value={status}
            onValueChange={(val) => {
              const next = val as Status;
              if (next === status) return;
              if (next === "closed" && status !== "closed") {
                onClosedStatusRequested();
                return;
              }
              setStatus(next);
              if (issue) {
                commit(buildStatusPatch(issue, next));
              }
            }}
            options={STATUS_OPTIONS}
            renderItem={renderStatusOption}
            placeholder={fieldNames.status}
            testId="issue-status-select"
            ariaLabelledby="issue-status-label"
          />
        </IssueFieldRow>

        <IssueFieldRow
          label={fieldNames.priority}
          labelId="issue-priority-label"
        >
          <EnumSelectField
            value={priority || NO_SELECTION}
            onValueChange={(val) => {
              const next = val === NO_SELECTION ? "" : (val as Priority);
              setPriority(next);
              if (issue && next !== (issue.priority ?? "")) {
                commit({ priority: next || null });
              }
            }}
            options={PRIORITY_OPTIONS}
            renderItem={renderPriorityOption}
            placeholder={empty.noPriority}
            noneOption={{ value: NO_SELECTION, label: empty.noPriority }}
            testId="issue-priority-select"
            ariaLabelledby="issue-priority-label"
          />
        </IssueFieldRow>

        <IssueFieldRow
          label={fieldNames.severity}
          labelId="issue-severity-label"
        >
          <EnumSelectField
            value={severity || NO_SELECTION}
            onValueChange={(val) => {
              const next = val === NO_SELECTION ? "" : (val as Severity);
              setSeverity(next);
              if (next !== (issue?.severity ?? "")) {
                commit({
                  severity: next ? next : null,
                } as IssueUpdatePatch);
              }
            }}
            options={SEVERITY_OPTIONS}
            renderItem={renderSeverityOption}
            placeholder={empty.noSeverity}
            noneOption={{ value: NO_SELECTION, label: empty.noSeverity }}
            testId="issue-severity-select"
            ariaLabelledby="issue-severity-label"
          />
        </IssueFieldRow>

        {/* Labels keeps a stacked label-above layout: the chip input wraps to
            multiple lines, so it reads better at full rail width than squeezed
            beside a fixed label. */}
        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="issue-labels"
          >
            {fieldNames.labels}
          </label>
          <LabelChipInput
            id="issue-labels"
            value={labels}
            onChange={(next) => {
              setLabels(next);
              if (issue && !sameStringArray(next, issue.labels ?? [])) {
                commit({ labels: next });
              }
            }}
            placeholder={c("addLabelPlaceholder")}
            data-testid="issue-labels-input"
          />
        </div>
      </IssueFormSection>

      <IssueFormSection title={s("people")}>
        <IssueFieldRow label={fieldNames.assignee} htmlFor="issue-assignee">
          <AssigneeCombobox
            id="issue-assignee"
            value={assignee}
            onChange={(val) => {
              setAssignee(val);
              if (issue && val !== (issue.assigned_to ?? "")) {
                commit({ assigned_to: val || null });
              }
            }}
            vault={vault}
            label={fieldNames.assignee}
            emptyLabel={empty.unassigned}
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.requester} htmlFor="issue-requester">
          <AssigneeCombobox
            id="issue-requester"
            value={requester}
            onChange={(val) => {
              setRequester(val);
              if (issue && val !== (issue.requester ?? "")) {
                commit({ requester: val || null } as IssueUpdatePatch);
              }
            }}
            vault={vault}
            label={fieldNames.requester}
            emptyLabel={t("noRequester")}
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.reporter} htmlFor="issue-reporter">
          <AssigneeCombobox
            id="issue-reporter"
            value={reporter}
            onChange={(val) => {
              setReporter(val);
              if (issue && val !== (issue.reporter ?? "")) {
                commit({ reporter: val || null } as IssueUpdatePatch);
              }
            }}
            vault={vault}
            label={fieldNames.reporter}
            emptyLabel={t("noReporter")}
          />
        </IssueFieldRow>
      </IssueFormSection>

      <IssueFormSection title={s("planning")}>
        <IssueFieldRow label={fieldNames.start} htmlFor="issue-start-date">
          <DatePickerField
            id="issue-start-date"
            label={fieldNames.start}
            value={startDate}
            onChange={(next) => {
              setStartDate(next);
              commitTextField("start_date", next, issue?.start_date);
            }}
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.due} htmlFor="issue-due-date">
          <DatePickerField
            id="issue-due-date"
            label={fieldNames.due}
            align="end"
            value={dueDate}
            onChange={(next) => {
              setDueDate(next);
              commitTextField("due_date", next, issue?.due_date);
            }}
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.sprint} htmlFor="issue-sprint">
          <PlanningItemCombobox
            kind="sprints"
            id="issue-sprint"
            vault={vault}
            value={sprintId}
            onChange={(next) => {
              setSprintId(next);
              commitSelectionField("sprint_id", next, issue?.sprint_id);
            }}
            assignableOnly
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.milestone} htmlFor="issue-milestone">
          <PlanningItemCombobox
            kind="milestones"
            id="issue-milestone"
            vault={vault}
            value={milestoneId}
            onChange={(next) => {
              setMilestoneId(next);
              commitSelectionField("milestone_id", next, issue?.milestone_id);
            }}
            assignableOnly
          />
        </IssueFieldRow>

        <IssueFieldRow
          label={fieldNames.release}
          htmlFor="issue-target-release"
        >
          <PlanningItemCombobox
            kind="releases"
            id="issue-target-release"
            vault={vault}
            value={releaseId}
            onChange={(next) => {
              setReleaseId(next);
              commitSelectionField("release_id", next, issue?.release_id);
            }}
            assignableOnly
          />
        </IssueFieldRow>

        <IssueFieldRow label={fieldNames.points} htmlFor="issue-estimate">
          <Input
            id="issue-estimate"
            type="number"
            min="0"
            step="0.5"
            value={estimatePoints}
            onChange={(e) => setEstimatePoints(e.target.value)}
            onBlur={(e) =>
              commitNumberField(
                "estimate_points",
                e.currentTarget.value,
                issue?.estimate_points,
              )
            }
          />
        </IssueFieldRow>
      </IssueFormSection>

      <IssueFormSection title={fieldNames.parent}>
        <IssueRelationInput
          id="issue-parent"
          label={fieldNames.parent}
          hideLabel
          value={parentId ? [parentId] : []}
          allIssues={allIssues}
          relationGraph={relations}
          currentIssueId={issueId}
          onChange={(next) => {
            const nextParent = next[0] ?? "";
            setParentId(nextParent);
            if (nextParent !== (issue?.parent_id ?? "")) {
              commit({
                parent_id: nextParent || null,
              } as IssueUpdatePatch);
            }
          }}
          maxItems={1}
        />
      </IssueFormSection>

      <IssueFormSection title={s("relationships")}>
        <div className="flex flex-col gap-3">
          <IssueRelationInput
            id="issue-depends-on"
            label={fieldNames.dependsOn}
            value={dependsOn}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setDependsOn(next);
              if (!sameStringArray(next, issue?.depends_on ?? [])) {
                commit({ depends_on: next });
              }
            }}
          />
          <IssueRelationInput
            id="issue-blocks"
            label={fieldNames.blocks}
            value={blocks}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setBlocks(next);
              if (!sameStringArray(next, issue?.blocks ?? [])) {
                commit({ blocks: next });
              }
            }}
          />
          <IssueRelationInput
            id="issue-related-to"
            label={fieldNames.related}
            value={relatedTo}
            allIssues={allIssues}
            relationGraph={relations}
            currentIssueId={issueId}
            navigable
            onChange={(next) => {
              setRelatedTo(next);
              if (!sameStringArray(next, issue?.related_to ?? [])) {
                commit({ related_to: next });
              }
            }}
          />
        </div>
      </IssueFormSection>
    </aside>
  );
}
