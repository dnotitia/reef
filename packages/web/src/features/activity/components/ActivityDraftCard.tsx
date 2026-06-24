"use client";

import { TypePill } from "@/components/fields/TypePill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArtifactMetadata, ReviewActions } from "@/features/ai/review";
import { IssueDraftFields } from "@/features/issues/components/create/IssueDraftFields";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import type { PrioritySelection } from "@/features/issues/lib/issueDraftForm";
import { ISSUE_TYPE_OPTIONS } from "@/features/issues/lib/metadataOptions";
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import { findPlanningName } from "@/features/planning/lib/planningItems";
import { useIssueTypeLabels, useSeverityLabels } from "@/i18n/fieldLabels";
import type {
  ActivityDraftSuggestion,
  IssueCreateInput,
  IssueType,
  Severity,
} from "@reef/core";
import { NO_SELECTION } from "@reef/core/fields";
import Link from "next/link";
import { useState } from "react";
import {
  githubActivityUrl,
  implementationRefLabel,
  implementationRefUrl,
} from "../lib/activityLinks";
import type { ActivityFeedItem } from "../types";
import { ActivityCardHeader } from "./ActivityCardHeader";
import { ActivityDraftEditMetadataFields } from "./ActivityDraftEditMetadataFields";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";
const LINK_CHIP_CLASS =
  "rounded-full bg-background/70 px-2 py-0.5 hover:text-foreground hover:underline";

function uniqueIssueIds(ids: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)),
    ),
  ];
}

export type ActivityDraftEditPatch = IssueCreateInput;

export function ActivityDraftCard({
  item,
  onApprove,
  onDismiss,
  onSaveEdits,
  vault,
  isApproving,
}: {
  item: Extract<ActivityFeedItem, { type: "ai_draft" }>;
  onApprove?: (draft: ActivityDraftSuggestion) => Promise<void>;
  onDismiss?: (draftId: string) => void;
  onSaveEdits?: (
    draftId: string,
    edits: ActivityDraftEditPatch,
  ) => Promise<void>;
  vault?: string;
  isApproving: boolean;
}) {
  const issueTypeLabels = useIssueTypeLabels();
  const severityLabels = useSeverityLabels();
  const { draft } = item;
  const create = draft.proposal.create;
  const fields = create.fields;
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(fields.title);
  const [content, setContent] = useState(create.content);
  const [issueType, setIssueType] = useState<IssueType>(
    fields.issue_type ?? "task",
  );
  const [priority, setPriority] = useState<PrioritySelection>(
    fields.priority ?? NO_SELECTION,
  );
  const [assignee, setAssignee] = useState(fields.assigned_to ?? "");
  const [requester, setRequester] = useState(fields.requester ?? "");
  const [reporter, setReporter] = useState(fields.reporter ?? "");
  const [startDate, setStartDate] = useState(
    fields.start_date?.slice(0, 10) ?? "",
  );
  const [dueDate, setDueDate] = useState(fields.due_date?.slice(0, 10) ?? "");
  const [milestoneId, setMilestoneId] = useState(fields.milestone_id ?? "");
  const [sprintId, setSprintId] = useState(fields.sprint_id ?? "");
  const [releaseId, setReleaseId] = useState(fields.release_id ?? "");
  const [estimatePoints, setEstimatePoints] = useState(
    fields.estimate_points == null ? "" : String(fields.estimate_points),
  );
  const [severity, setSeverity] = useState<Severity | "">(
    fields.severity ?? "",
  );
  const [parentId, setParentId] = useState(fields.parent_id ?? "");
  const [dependsOn, setDependsOn] = useState<string[]>(fields.depends_on ?? []);
  const [blocks, setBlocks] = useState<string[]>(fields.blocks ?? []);
  const [relatedTo, setRelatedTo] = useState<string[]>(fields.related_to ?? []);
  const [labels, setLabels] = useState<string[]>(fields.labels ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const { data: allIssues = [] } = useIssueList(vault ?? "");
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault ?? "");
  // Resolve planning ids to human names the same way board/list surfaces do, so
  // the draft chips read "Sprint 3" instead of a raw id (REEF-233). A null name
  // (id absent or not yet in the catalog) hides the chip.
  const { data: planningCatalog } = usePlanningCatalog(vault ?? "");
  const sprintName = findPlanningName(
    planningCatalog,
    "sprints",
    fields.sprint_id,
  );
  const milestoneName = findPlanningName(
    planningCatalog,
    "milestones",
    fields.milestone_id,
  );
  const releaseName = findPlanningName(
    planningCatalog,
    "releases",
    fields.release_id,
  );
  const relationLinks = [
    ...uniqueIssueIds([fields.parent_id]).map((id) => ({
      label: "parent",
      id,
    })),
    ...uniqueIssueIds(fields.depends_on ?? []).map((id) => ({
      label: "depends",
      id,
    })),
    ...uniqueIssueIds(fields.blocks ?? []).map((id) => ({
      label: "blocks",
      id,
    })),
    ...uniqueIssueIds(fields.related_to ?? []).map((id) => ({
      label: "related",
      id,
    })),
  ];

  const handleCancel = () => {
    setTitle(fields.title);
    setContent(create.content);
    setIssueType(fields.issue_type ?? "task");
    setPriority(fields.priority ?? NO_SELECTION);
    setAssignee(fields.assigned_to ?? "");
    setRequester(fields.requester ?? "");
    setReporter(fields.reporter ?? "");
    setStartDate(fields.start_date?.slice(0, 10) ?? "");
    setDueDate(fields.due_date?.slice(0, 10) ?? "");
    setMilestoneId(fields.milestone_id ?? "");
    setSprintId(fields.sprint_id ?? "");
    setReleaseId(fields.release_id ?? "");
    setEstimatePoints(
      fields.estimate_points == null ? "" : String(fields.estimate_points),
    );
    setSeverity(fields.severity ?? "");
    setParentId(fields.parent_id ?? "");
    setDependsOn(fields.depends_on ?? []);
    setBlocks(fields.blocks ?? []);
    setRelatedTo(fields.related_to ?? []);
    setLabels(fields.labels ?? []);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!onSaveEdits) return;
    if (estimatePoints.trim() && Number.isNaN(Number(estimatePoints.trim()))) {
      return;
    }
    setIsSaving(true);
    try {
      await onSaveEdits(draft.id, {
        fields: {
          title: title.trim(),
          issue_type: issueType,
          priority: priority === NO_SELECTION ? null : priority,
          assigned_to: assignee.trim() || null,
          requester: requester.trim() || null,
          reporter: reporter.trim() || null,
          start_date: startDate || null,
          due_date: dueDate || null,
          milestone_id: milestoneId || null,
          sprint_id: sprintId || null,
          release_id: releaseId || null,
          estimate_points: estimatePoints.trim()
            ? Number(estimatePoints.trim())
            : null,
          severity: severity || null,
          parent_id: parentId.trim() || null,
          depends_on: dependsOn.length > 0 ? dependsOn : undefined,
          blocks: blocks.length > 0 ? blocks : undefined,
          related_to: relatedTo.length > 0 ? relatedTo : undefined,
          labels: labels.length > 0 ? labels : undefined,
          ...(fields.implementation_refs
            ? { implementation_refs: fields.implementation_refs }
            : {}),
          // Preserve the code-signal status the draft was created with (REEF-130).
          // The edit form doesn't expose status, so rebuilding `fields` without
          // it would strip it and drop the draft into `backlog` on approval.
          ...(fields.status ? { status: fields.status } : {}),
        },
        content,
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="activity-item-ai_draft"
      className="rounded-md border border-ai-border bg-ai-subtle px-4 py-3"
    >
      <ActivityCardHeader badge="AI Draft" timestamp={item.timestamp}>
        {!isEditing && (
          <span className="text-sm font-medium text-foreground">
            {fields.title}
          </span>
        )}
        <ArtifactMetadata
          className="mt-1"
          confidence={draft.confidence}
          reasoning={draft.reasoning}
          evidence={[
            {
              type: draft.provenance.type,
              ref: draft.provenance.ref,
              label: `${draft.provenance.type} ${draft.provenance.ref}`,
              url: githubActivityUrl({
                type: draft.provenance.type,
                repo: draft.provenance.repo,
                ref: draft.provenance.ref,
              }),
              metadata: {
                repo: draft.provenance.repo,
                actor: draft.provenance.actor,
                detectedAt: draft.provenance.detectedAt,
              },
            },
          ]}
        />
        {!isEditing && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <TypePill type={fields.issue_type} variant="activity" />
            {fields.severity && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                {severityLabels[fields.severity]}
              </span>
            )}
            {fields.start_date && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                start {fields.start_date.slice(0, 10)}
              </span>
            )}
            {fields.due_date && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                due {fields.due_date.slice(0, 10)}
              </span>
            )}
            {sprintName && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                sprint {sprintName}
              </span>
            )}
            {milestoneName && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                milestone {milestoneName}
              </span>
            )}
            {releaseName && (
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                release {releaseName}
              </span>
            )}
            {fields.implementation_refs &&
              fields.implementation_refs.length > 0 &&
              fields.implementation_refs.map((ref, index) => {
                const label = implementationRefLabel(ref);
                const href = implementationRefUrl(ref);
                const key = `${ref.type}:${ref.repo ?? ""}:${ref.ref}:${index}`;

                return href ? (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={LINK_CHIP_CLASS}
                    title={ref.title ?? label}
                  >
                    {label}
                  </a>
                ) : (
                  <span
                    key={key}
                    className="rounded-full bg-background/70 px-2 py-0.5"
                  >
                    {label}
                  </span>
                );
              })}
            {relationLinks.map(({ label, id }) => (
              <Link
                key={`${label}:${id}`}
                href={`/issues/${id}`}
                className={LINK_CHIP_CLASS}
              >
                {label} <span className="font-mono">{id}</span>
              </Link>
            ))}
          </div>
        )}
      </ActivityCardHeader>

      {isEditing && (
        <div className="mt-3" data-testid="draft-edit-panel">
          <IssueDraftFields
            title={title}
            onTitleChange={setTitle}
            priority={priority}
            onPriorityChange={setPriority}
            labels={labels}
            onLabelsChange={setLabels}
            body={content}
            onBodyChange={setContent}
            titleId={`draft-edit-title-${draft.id}`}
            labelsId={`draft-edit-labels-${draft.id}`}
            titleTestId="draft-edit-title"
            priorityTestId="draft-edit-priority"
            labelsTestId="draft-edit-labels"
            bodyTestId="draft-edit-description"
            bodyPlaceholder="Describe the issue…"
            primaryField={
              <div className="flex flex-col gap-1">
                <span
                  id={`draft-edit-type-label-${draft.id}`}
                  className={FIELD_LABEL_CLASS}
                >
                  Type
                </span>
                <Select
                  value={issueType}
                  onValueChange={(value) => setIssueType(value as IssueType)}
                >
                  <SelectTrigger
                    aria-labelledby={`draft-edit-type-label-${draft.id}`}
                  >
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {issueTypeLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
            beforeDescription={
              <ActivityDraftEditMetadataFields
                draftId={draft.id}
                vault={vault}
                allIssues={allIssues}
                relations={relations}
                assignee={assignee}
                requester={requester}
                reporter={reporter}
                startDate={startDate}
                dueDate={dueDate}
                estimatePoints={estimatePoints}
                severity={severity}
                sprintId={sprintId}
                milestoneId={milestoneId}
                releaseId={releaseId}
                parentId={parentId}
                dependsOn={dependsOn}
                blocks={blocks}
                relatedTo={relatedTo}
                setAssignee={setAssignee}
                setRequester={setRequester}
                setReporter={setReporter}
                setStartDate={setStartDate}
                setDueDate={setDueDate}
                setEstimatePoints={setEstimatePoints}
                setSeverity={setSeverity}
                setSprintId={setSprintId}
                setMilestoneId={setMilestoneId}
                setReleaseId={setReleaseId}
                setParentId={setParentId}
                setDependsOn={setDependsOn}
                setBlocks={setBlocks}
                setRelatedTo={setRelatedTo}
              />
            }
          />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {isEditing ? (
          <ReviewActions
            actions={[
              {
                id: "save",
                label: "Save",
                busy: isSaving,
                onClick: handleSave,
                testId: "draft-save",
              },
              { id: "cancel", label: "Cancel", onClick: handleCancel },
            ]}
          />
        ) : (
          <ReviewActions
            actions={[
              {
                id: "approve",
                label: "Approve",
                busy: isApproving,
                busyLabel: "Approving...",
                onClick: () => onApprove?.(draft),
              },
              {
                id: "edit",
                label: "Edit",
                onClick: () => setIsEditing(true),
                testId: "draft-edit",
              },
              {
                id: "dismiss",
                label: "Dismiss",
                onClick: () => onDismiss?.(draft.id),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
