"use client";

import type {
  ExternalRef,
  ImplementationRef,
  IssueDocument,
  IssueType,
  Priority,
  Severity,
  Status,
} from "@reef/core";
import { dateInputValue } from "../../lib/metadataOptions";

export interface IssueDetailDraft {
  title: string;
  issueType: IssueType;
  status: Status;
  priority: Priority | "";
  assignee: string;
  requester: string;
  reporter: string;
  startDate: string;
  dueDate: string;
  milestoneId: string;
  sprintId: string;
  releaseId: string;
  estimatePoints: string;
  severity: Severity | "";
  parentId: string;
  labels: string[];
  dependsOn: string[];
  blocks: string[];
  relatedTo: string[];
  externalRefs: ExternalRef[];
  implementationRefs: ImplementationRef[];
  body: string;
}

type IssueDetailDraftField = keyof IssueDetailDraft;
type IssueDetailDraftValue = IssueDetailDraft[IssueDetailDraftField];

const ISSUE_DETAIL_DRAFT_FIELDS = [
  "title",
  "issueType",
  "status",
  "priority",
  "assignee",
  "requester",
  "reporter",
  "startDate",
  "dueDate",
  "milestoneId",
  "sprintId",
  "releaseId",
  "estimatePoints",
  "severity",
  "parentId",
  "labels",
  "dependsOn",
  "blocks",
  "relatedTo",
  "externalRefs",
  "implementationRefs",
  "body",
] as const satisfies readonly IssueDetailDraftField[];

export type IssueDetailDraftAction =
  | {
      type: "set";
      field: IssueDetailDraftField;
      value: IssueDetailDraftValue;
    }
  | {
      type: "sync";
      previous: IssueDetailDraft;
      next: IssueDetailDraft;
    }
  | {
      // Replace the whole draft with a server snapshot, discarding local edits.
      // Used on a save conflict (REEF-227) to drop the rejected edit so a stale
      // dirty field doesn't be re-saved over the change that won.
      type: "reset";
      next: IssueDetailDraft;
    };

export function createIssueDetailDraft(data: IssueDocument): IssueDetailDraft {
  const { issue } = data;
  return {
    title: issue.title,
    issueType: issue.issue_type ?? "task",
    status: issue.status,
    priority: issue.priority ?? "",
    assignee: issue.assigned_to ?? "",
    requester: issue.requester ?? "",
    reporter: issue.reporter ?? "",
    startDate: dateInputValue(issue.start_date),
    dueDate: dateInputValue(issue.due_date),
    milestoneId: issue.milestone_id ?? "",
    sprintId: issue.sprint_id ?? "",
    releaseId: issue.release_id ?? "",
    estimatePoints:
      issue.estimate_points == null ? "" : String(issue.estimate_points),
    severity: issue.severity ?? "",
    parentId: issue.parent_id ?? "",
    labels: issue.labels ?? [],
    dependsOn: issue.depends_on ?? [],
    blocks: issue.blocks ?? [],
    relatedTo: issue.related_to ?? [],
    externalRefs: issue.external_refs ?? [],
    implementationRefs: issue.implementation_refs ?? [],
    body: data.content ?? "",
  };
}

export function issueDetailDraftReducer(
  state: IssueDetailDraft,
  action: IssueDetailDraftAction,
): IssueDetailDraft {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value };
    case "reset":
      // Discard local edits wholesale (conflict recovery, REEF-227).
      return action.next;
    case "sync": {
      // Pull newer server data into fields the user has not edited locally since
      // the previous server snapshot; keep dirty fields intact.
      let nextState = state;
      for (const field of ISSUE_DETAIL_DRAFT_FIELDS) {
        const currentValue = state[field];
        const previousValue = action.previous[field];
        const nextValue = action.next[field];
        if (
          sameDraftValue(currentValue, previousValue) &&
          !sameDraftValue(currentValue, nextValue)
        ) {
          nextState = { ...nextState, [field]: nextValue };
        }
      }
      return nextState;
    }
  }
}

function sameDraftValue(
  a: IssueDetailDraftValue | unknown,
  b: IssueDetailDraftValue | unknown,
): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && sameDraftArray(a, b);
  }
  if (!isRecord(a) || !isRecord(b)) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameDraftValue(a[key], b[key]),
  );
}

function sameDraftArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => sameDraftValue(item, b[index]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
