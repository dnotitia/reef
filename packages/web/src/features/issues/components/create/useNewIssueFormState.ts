"use client";

import type { EnrichmentFormApi } from "@/features/ai/lib/enrichmentFieldDescriptors";
import type {
  ExternalRef,
  IssueCreateFields,
  IssueType,
  Severity,
} from "@reef/core";
import { NO_SELECTION } from "@reef/core/fields";
import { useCallback, useState } from "react";
import type { PrioritySelection } from "../../lib/issueDraftForm";

export interface NewIssueFormDefaults {
  issueType?: IssueType;
  priority?: PrioritySelection | null;
  milestoneId?: string | null;
  sprintId?: string | null;
  parentId?: string | null;
  labels?: string[];
}

export function useNewIssueFormState() {
  const [title, setTitle] = useState("");
  const [issueType, setIssueType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<PrioritySelection>(NO_SELECTION);
  const [assignee, setAssignee] = useState("");
  const [requester, setRequester] = useState("");
  const [reporter, setReporter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [estimatePoints, setEstimatePoints] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [parentId, setParentId] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [relatedTo, setRelatedTo] = useState<string[]>([]);
  const [externalRefs, setExternalRefs] = useState<ExternalRef[]>([]);
  // akb document references (REEF-083 AC4) — NOT an issue metadata field, so
  // kept out of formApi / buildCreateFields; passed on the create request and
  // linked post-write by the server.
  const [references, setReferences] = useState<string[]>([]);
  const [body, setBody] = useState("");

  const formApi: EnrichmentFormApi = {
    values: {
      title,
      content: body,
      issueType,
      priority,
      assignee,
      requester,
      reporter,
      startDate,
      dueDate,
      milestoneId,
      sprintId,
      releaseId,
      estimatePoints,
      severity,
      parentId,
      labels,
      dependsOn,
      blocks,
      relatedTo,
      externalRefs,
    },
    setTitle,
    setBody,
    setIssueType,
    setPriority,
    setAssignee,
    setRequester,
    setReporter,
    setStartDate,
    setDueDate,
    setMilestoneId,
    setSprintId,
    setReleaseId,
    setEstimatePoints,
    setSeverity,
    setParentId,
    setLabels,
    setDependsOn,
    setBlocks,
    setRelatedTo,
    setExternalRefs,
  };

  const resetFields = useCallback((defaults: NewIssueFormDefaults = {}) => {
    setTitle("");
    setIssueType(defaults.issueType ?? "task");
    setPriority(defaults.priority ?? NO_SELECTION);
    setAssignee("");
    setRequester("");
    setReporter("");
    setStartDate("");
    setDueDate("");
    setMilestoneId(defaults.milestoneId ?? "");
    setSprintId(defaults.sprintId ?? "");
    setReleaseId("");
    setEstimatePoints("");
    setSeverity("");
    setParentId(defaults.parentId ?? "");
    setLabels(defaults.labels ?? []);
    setDependsOn([]);
    setBlocks([]);
    setRelatedTo([]);
    setExternalRefs([]);
    setReferences([]);
    setBody("");
  }, []);

  function buildCreateFields(input?: {
    fallbackTitle?: string;
    status?: IssueCreateFields["status"];
  }): IssueCreateFields {
    return {
      title: title.trim() || input?.fallbackTitle || title.trim(),
      issue_type: issueType,
      ...(input?.status ? { status: input.status } : {}),
      ...(priority !== NO_SELECTION ? { priority } : {}),
      ...(assignee.trim() ? { assigned_to: assignee.trim() } : {}),
      ...(requester.trim() ? { requester: requester.trim() } : {}),
      ...(reporter.trim() ? { reporter: reporter.trim() } : {}),
      ...(startDate ? { start_date: startDate } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(milestoneId ? { milestone_id: milestoneId } : {}),
      ...(sprintId ? { sprint_id: sprintId } : {}),
      ...(releaseId ? { release_id: releaseId } : {}),
      ...(estimatePoints.trim()
        ? { estimate_points: Number(estimatePoints.trim()) }
        : {}),
      ...(severity ? { severity } : {}),
      ...(parentId ? { parent_id: parentId } : {}),
      ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(relatedTo.length > 0 ? { related_to: relatedTo } : {}),
      ...(externalRefs.length > 0 ? { external_refs: externalRefs } : {}),
      ...(labels.length > 0 ? { labels } : {}),
    };
  }

  return {
    title,
    setTitle,
    issueType,
    setIssueType,
    priority,
    setPriority,
    assignee,
    setAssignee,
    requester,
    setRequester,
    reporter,
    setReporter,
    startDate,
    setStartDate,
    dueDate,
    setDueDate,
    milestoneId,
    setMilestoneId,
    sprintId,
    setSprintId,
    releaseId,
    setReleaseId,
    estimatePoints,
    setEstimatePoints,
    severity,
    setSeverity,
    parentId,
    setParentId,
    labels,
    setLabels,
    dependsOn,
    setDependsOn,
    blocks,
    setBlocks,
    relatedTo,
    setRelatedTo,
    externalRefs,
    setExternalRefs,
    references,
    setReferences,
    body,
    setBody,
    formApi,
    resetFields,
    buildCreateFields,
  };
}
