"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { DatePickerField } from "@/components/fields/DatePickerField";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IssueRelationInput } from "@/features/issues/components/relations/IssueRelationInput";
import { IssueFormSection } from "@/features/issues/components/shared/IssueFormSection";
import {
  NO_SELECTION,
  SEVERITY_OPTIONS,
} from "@/features/issues/lib/metadataOptions";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
  useSeverityLabels,
} from "@/i18n/fieldLabels";
import type { IssueListItem, Severity } from "@reef/core";
import { useTranslations } from "next-intl";
import type { ComponentProps, Dispatch, SetStateAction } from "react";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

export function ActivityDraftEditMetadataFields({
  draftId,
  vault,
  allIssues,
  relations,
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
  parentId,
  dependsOn,
  blocks,
  relatedTo,
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
  setParentId,
  setDependsOn,
  setBlocks,
  setRelatedTo,
}: {
  draftId: string;
  vault?: string;
  allIssues: readonly IssueListItem[];
  relations: ComponentProps<typeof IssueRelationInput>["relationGraph"];
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
  parentId: string;
  dependsOn: string[];
  blocks: string[];
  relatedTo: string[];
  setAssignee: Dispatch<SetStateAction<string>>;
  setRequester: Dispatch<SetStateAction<string>>;
  setReporter: Dispatch<SetStateAction<string>>;
  setStartDate: Dispatch<SetStateAction<string>>;
  setDueDate: Dispatch<SetStateAction<string>>;
  setEstimatePoints: Dispatch<SetStateAction<string>>;
  setSeverity: Dispatch<SetStateAction<Severity | "">>;
  setSprintId: Dispatch<SetStateAction<string>>;
  setMilestoneId: Dispatch<SetStateAction<string>>;
  setReleaseId: Dispatch<SetStateAction<string>>;
  setParentId: Dispatch<SetStateAction<string>>;
  setDependsOn: Dispatch<SetStateAction<string[]>>;
  setBlocks: Dispatch<SetStateAction<string[]>>;
  setRelatedTo: Dispatch<SetStateAction<string[]>>;
}) {
  const severityLabels = useSeverityLabels();
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const sections = useTranslations("sections");
  const t = useTranslations("activity");
  return (
    <div className="grid gap-4">
      <IssueFormSection title={sections("people")}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-assignee-${draftId}`}
            >
              {fieldNames.assignee}
            </label>
            <AssigneeCombobox
              id={`draft-edit-assignee-${draftId}`}
              value={assignee}
              onChange={setAssignee}
              vault={vault ?? ""}
              label={fieldNames.assignee}
              emptyLabel={empty.unassigned}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-requester-${draftId}`}
            >
              {fieldNames.requester}
            </label>
            <AssigneeCombobox
              id={`draft-edit-requester-${draftId}`}
              value={requester}
              onChange={setRequester}
              vault={vault ?? ""}
              label={fieldNames.requester}
              emptyLabel={t("noRequester")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-reporter-${draftId}`}
            >
              {fieldNames.reporter}
            </label>
            <AssigneeCombobox
              id={`draft-edit-reporter-${draftId}`}
              value={reporter}
              onChange={setReporter}
              vault={vault ?? ""}
              label={fieldNames.reporter}
              emptyLabel={t("noReporter")}
            />
          </div>
        </div>
      </IssueFormSection>

      <IssueFormSection title={sections("planning")}>
        <div className="grid gap-3 md:grid-cols-6">
          <div className="flex flex-col gap-1 md:col-span-3">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-start-date-${draftId}`}
            >
              {fieldNames.start}
            </label>
            <DatePickerField
              id={`draft-edit-start-date-${draftId}`}
              label={fieldNames.start}
              value={startDate}
              onChange={setStartDate}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-3">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-due-date-${draftId}`}
            >
              {fieldNames.due}
            </label>
            <DatePickerField
              id={`draft-edit-due-date-${draftId}`}
              label={fieldNames.due}
              align="end"
              value={dueDate}
              onChange={setDueDate}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-3">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-estimate-${draftId}`}
            >
              {fieldNames.points}
            </label>
            <Input
              id={`draft-edit-estimate-${draftId}`}
              type="number"
              min="0"
              step="0.5"
              value={estimatePoints}
              onChange={(e) => setEstimatePoints(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-3">
            <span
              id={`draft-edit-severity-label-${draftId}`}
              className={FIELD_LABEL_CLASS}
            >
              {fieldNames.severity}
            </span>
            <Select
              value={severity || NO_SELECTION}
              onValueChange={(value) =>
                setSeverity(value === NO_SELECTION ? "" : (value as Severity))
              }
            >
              <SelectTrigger
                aria-labelledby={`draft-edit-severity-label-${draftId}`}
              >
                <SelectValue placeholder={empty.noSeverity} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>{empty.noSeverity}</SelectItem>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {severityLabels[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-sprint-${draftId}`}
            >
              {fieldNames.sprint}
            </label>
            <PlanningItemCombobox
              kind="sprints"
              id={`draft-edit-sprint-${draftId}`}
              vault={vault ?? ""}
              value={sprintId}
              onChange={setSprintId}
              assignableOnly
              testId="draft-edit-sprint"
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-milestone-${draftId}`}
            >
              {fieldNames.milestone}
            </label>
            <PlanningItemCombobox
              kind="milestones"
              id={`draft-edit-milestone-${draftId}`}
              vault={vault ?? ""}
              value={milestoneId}
              onChange={setMilestoneId}
              assignableOnly
              testId="draft-edit-milestone"
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label
              className={FIELD_LABEL_CLASS}
              htmlFor={`draft-edit-release-${draftId}`}
            >
              {fieldNames.release}
            </label>
            <PlanningItemCombobox
              kind="releases"
              id={`draft-edit-release-${draftId}`}
              vault={vault ?? ""}
              value={releaseId}
              onChange={setReleaseId}
              assignableOnly
              testId="draft-edit-release"
            />
          </div>
        </div>
      </IssueFormSection>

      <IssueFormSection title={sections("relationships")}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <IssueRelationInput
            id={`draft-edit-parent-${draftId}`}
            label={fieldNames.parent}
            value={parentId ? [parentId] : []}
            allIssues={allIssues}
            relationGraph={relations}
            onChange={(next) => setParentId(next[0] ?? "")}
            maxItems={1}
          />
          <IssueRelationInput
            id={`draft-edit-depends-on-${draftId}`}
            label={fieldNames.dependsOn}
            value={dependsOn}
            allIssues={allIssues}
            relationGraph={relations}
            onChange={setDependsOn}
          />
          <IssueRelationInput
            id={`draft-edit-blocks-${draftId}`}
            label={fieldNames.blocks}
            value={blocks}
            allIssues={allIssues}
            relationGraph={relations}
            onChange={setBlocks}
          />
          <IssueRelationInput
            id={`draft-edit-related-to-${draftId}`}
            label={fieldNames.related}
            value={relatedTo}
            allIssues={allIssues}
            relationGraph={relations}
            onChange={setRelatedTo}
          />
        </div>
      </IssueFormSection>
    </div>
  );
}
