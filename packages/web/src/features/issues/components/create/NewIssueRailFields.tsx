"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { DatePickerField } from "@/components/fields/DatePickerField";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { SeverityBadge } from "@/components/fields/SeverityBadge";
import { Input } from "@/components/ui/input";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import type { EnrichmentField, Severity } from "@reef/core";
import type { ReactNode } from "react";
import { NO_SELECTION, SEVERITY_OPTIONS } from "../../lib/metadataOptions";
import { IssueFieldRow } from "../shared/IssueFieldRow";
import { IssueFormSection } from "../shared/IssueFormSection";

type RenderEnrichable = (
  field: EnrichmentField,
  control: ReactNode,
) => ReactNode;

type RenderFieldLabel = (
  field: EnrichmentField,
  htmlFor: string,
  text: string,
) => ReactNode;

/**
 * Right-rail metadata for the new-issue dialog: People and Planning. Each field
 * is one property row — a fixed label and a full-width value (REEF-167) —
 * mirroring the issue detail sidebar so the same metadata reads the same on the
 * create and edit surfaces, and so long planning-item names get the whole rail
 * width instead of a `grid-cols-2` half-cell. Relationships and refs live in the
 * main column instead (see NewIssueRelationFields).
 */
export function NewIssueRailFields({
  vault,
  isSubmitting,
  assignee,
  requester,
  reporter,
  startDate,
  dueDate,
  estimatePoints,
  severity,
  sprintId,
  milestoneId,
  releaseId,
  setAssignee,
  setRequester,
  setReporter,
  setStartDate,
  setDueDate,
  setEstimatePoints,
  setSeverity,
  setSprintId,
  setMilestoneId,
  setReleaseId,
  renderEnrichable,
  renderFieldLabel,
}: {
  vault: string;
  isSubmitting: boolean;
  assignee: string;
  requester: string;
  reporter: string;
  startDate: string;
  dueDate: string;
  estimatePoints: string;
  severity: Severity | "";
  sprintId: string;
  milestoneId: string;
  releaseId: string;
  setAssignee: (value: string) => void;
  setRequester: (value: string) => void;
  setReporter: (value: string) => void;
  setStartDate: (value: string) => void;
  setDueDate: (value: string) => void;
  setEstimatePoints: (value: string) => void;
  setSeverity: (value: Severity | "") => void;
  setSprintId: (value: string) => void;
  setMilestoneId: (value: string) => void;
  setReleaseId: (value: string) => void;
  renderEnrichable: RenderEnrichable;
  renderFieldLabel: RenderFieldLabel;
}) {
  return (
    <>
      {/* People / Planning as property rows (REEF-167): a fixed label and a
          full-width value, mirroring the issue detail rail. The label comes from
          `renderFieldLabel` (an enrichment-aware `<label htmlFor>` ↔ `<span>`)
          via `IssueFieldRow`'s `labelSlot`, so the row owns the fixed gutter
          while the create dialog keeps its AI-suggestion label behavior. */}
      <IssueFormSection title="People">
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "assigned_to",
            "new-issue-assignee",
            "Assignee",
          )}
        >
          {renderEnrichable(
            "assigned_to",
            <AssigneeCombobox
              id="new-issue-assignee"
              value={assignee}
              onChange={setAssignee}
              vault={vault}
              label="Assignee"
              emptyLabel="Unassigned"
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "requester",
            "new-issue-requester",
            "Requester",
          )}
        >
          {renderEnrichable(
            "requester",
            <AssigneeCombobox
              id="new-issue-requester"
              value={requester}
              onChange={setRequester}
              vault={vault}
              label="Requester"
              emptyLabel="No requester"
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "reporter",
            "new-issue-reporter",
            "Reporter",
          )}
        >
          {renderEnrichable(
            "reporter",
            <AssigneeCombobox
              id="new-issue-reporter"
              value={reporter}
              onChange={setReporter}
              vault={vault}
              label="Reporter"
              emptyLabel="No reporter"
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
      </IssueFormSection>

      <IssueFormSection title="Planning">
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "start_date",
            "new-issue-start-date",
            "Start date",
          )}
        >
          {renderEnrichable(
            "start_date",
            <DatePickerField
              id="new-issue-start-date"
              label="Start date"
              value={startDate}
              onChange={setStartDate}
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "due_date",
            "new-issue-due-date",
            "Due date",
          )}
        >
          {renderEnrichable(
            "due_date",
            <DatePickerField
              id="new-issue-due-date"
              label="Due date"
              align="end"
              value={dueDate}
              onChange={setDueDate}
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "sprint_id",
            "new-issue-sprint",
            "Sprint",
          )}
        >
          {renderEnrichable(
            "sprint_id",
            <PlanningItemCombobox
              kind="sprints"
              id="new-issue-sprint"
              vault={vault}
              value={sprintId}
              onChange={setSprintId}
              assignableOnly
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "milestone_id",
            "new-issue-milestone",
            "Milestone",
          )}
        >
          {renderEnrichable(
            "milestone_id",
            <PlanningItemCombobox
              kind="milestones"
              id="new-issue-milestone"
              vault={vault}
              value={milestoneId}
              onChange={setMilestoneId}
              assignableOnly
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "release_id",
            "new-issue-target-release",
            "Release",
          )}
        >
          {renderEnrichable(
            "release_id",
            <PlanningItemCombobox
              kind="releases"
              id="new-issue-target-release"
              vault={vault}
              value={releaseId}
              onChange={setReleaseId}
              assignableOnly
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow
          labelSlot={renderFieldLabel(
            "estimate_points",
            "new-issue-estimate",
            "Estimate",
          )}
        >
          {renderEnrichable(
            "estimate_points",
            <Input
              id="new-issue-estimate"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={estimatePoints}
              onChange={(e) => setEstimatePoints(e.target.value)}
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
        <IssueFieldRow label="Severity" labelId="new-issue-severity-label">
          {renderEnrichable(
            "severity",
            <EnumSelectField
              value={severity || NO_SELECTION}
              onValueChange={(value) =>
                setSeverity(value === NO_SELECTION ? "" : (value as Severity))
              }
              options={SEVERITY_OPTIONS}
              renderItem={(s) => <SeverityBadge severity={s} />}
              placeholder="No severity"
              noneOption={{ value: NO_SELECTION, label: "No severity" }}
              ariaLabelledby="new-issue-severity-label"
              disabled={isSubmitting}
            />,
          )}
        </IssueFieldRow>
      </IssueFormSection>
    </>
  );
}
