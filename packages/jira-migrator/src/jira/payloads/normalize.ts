import { z } from "zod";
import type {
  NormalizedJiraAttachment,
  NormalizedJiraIssue,
  NormalizedJiraIssueLink,
  NormalizedJiraSprint,
  NormalizedJiraUser,
  NormalizedJiraVersion,
} from "./normalized.js";
import {
  type JiraAttachmentPayload,
  type JiraFieldPayload,
  type JiraIssueLinkPayload,
  type JiraIssuePayload,
  type JiraSprintPayload,
  JiraSprintSchema,
  type JiraUserPayload,
  type JiraVersionPayload,
} from "./schemas.js";

export const normalizeJiraUser = (
  user: JiraUserPayload | null | undefined,
): NormalizedJiraUser | null =>
  user
    ? {
        accountId: user.accountId ?? null,
        emailAddress: user.emailAddress ?? null,
        displayName: user.displayName ?? null,
        active: user.active ?? null,
        accountType: user.accountType ?? null,
        raw: user,
      }
    : null;

export const normalizeJiraAttachment = (
  attachment: JiraAttachmentPayload,
): NormalizedJiraAttachment => ({
  id: attachment.id,
  filename: attachment.filename,
  mimeType: attachment.mimeType ?? null,
  size: attachment.size ?? null,
  contentUrl: attachment.content ?? null,
  created: attachment.created ?? null,
  author: normalizeJiraUser(attachment.author),
});

export const normalizeJiraIssueLink = (
  link: JiraIssueLinkPayload,
): NormalizedJiraIssueLink | null => {
  const direction = link.inwardIssue ? "inward" : "outward";
  const issue = link.inwardIssue ?? link.outwardIssue;
  if (!issue) return null;

  return {
    id: link.id ?? null,
    typeId: link.type?.id ?? null,
    type: link.type?.name ?? null,
    inward: link.type?.inward ?? null,
    outward: link.type?.outward ?? null,
    direction,
    issueKey: issue.key,
    issueId: issue.id ?? null,
    label:
      direction === "inward"
        ? (link.type?.inward ?? link.type?.name ?? null)
        : (link.type?.outward ?? link.type?.name ?? null),
  };
};

export const normalizeJiraIssue = (
  issue: JiraIssuePayload,
): NormalizedJiraIssue => ({
  id: issue.id,
  key: issue.key,
  summary: issue.fields.summary ?? "",
  projectKey: issue.fields.project?.key ?? null,
  issueType: issue.fields.issuetype?.name ?? null,
  issueTypeId: issue.fields.issuetype?.id ?? null,
  issueTypeSubtask: issue.fields.issuetype?.subtask ?? false,
  issueTypeHierarchyLevel: issue.fields.issuetype?.hierarchyLevel ?? null,
  status: issue.fields.status?.name ?? null,
  statusId: issue.fields.status?.id ?? null,
  statusCategoryKey: issue.fields.status?.statusCategory?.key ?? null,
  statusCategoryName: issue.fields.status?.statusCategory?.name ?? null,
  description: issue.fields.description ?? null,
  priority: issue.fields.priority
    ? {
        id: issue.fields.priority.id ?? null,
        name: issue.fields.priority.name ?? null,
      }
    : null,
  dueDate: issue.fields.duedate ?? null,
  resolution: issue.fields.resolution
    ? {
        id: issue.fields.resolution.id ?? null,
        name: issue.fields.resolution.name ?? null,
      }
    : null,
  resolutionDate: issue.fields.resolutiondate ?? null,
  parent: issue.fields.parent
    ? { id: issue.fields.parent.id ?? null, key: issue.fields.parent.key }
    : null,
  fixVersions: issue.fields.fixVersions ?? [],
  affectedVersions: issue.fields.versions ?? [],
  components: issue.fields.components ?? [],
  environment: issue.fields.environment ?? null,
  watches: issue.fields.watches ?? null,
  votes: issue.fields.votes ?? null,
  timetracking: issue.fields.timetracking ?? null,
  worklog: issue.fields.worklog ?? null,
  created: issue.fields.created ?? null,
  updated: issue.fields.updated ?? null,
  labels: issue.fields.labels ?? [],
  attachments: (issue.fields.attachment ?? []).map(normalizeJiraAttachment),
  links: (issue.fields.issuelinks ?? [])
    .map(normalizeJiraIssueLink)
    .filter((link): link is NormalizedJiraIssueLink => link !== null),
  users: {
    assignee: normalizeJiraUser(issue.fields.assignee),
    reporter: normalizeJiraUser(issue.fields.reporter),
    creator: normalizeJiraUser(issue.fields.creator),
  },
  raw: issue,
});

export const normalizeJiraVersion = (
  version: JiraVersionPayload,
): NormalizedJiraVersion => ({
  id: version.id,
  projectId: version.projectId,
  name: version.name,
  description: version.description ?? null,
  startDate: version.startDate ?? null,
  releaseDate: version.releaseDate ?? null,
  released: version.released,
  archived: version.archived,
});

export const normalizeJiraSprint = (
  sprint: JiraSprintPayload,
): NormalizedJiraSprint => ({
  id: sprint.id,
  state: sprint.state,
  name: sprint.name,
  startDate: sprint.startDate ?? null,
  endDate: sprint.endDate ?? null,
  completeDate: sprint.completeDate ?? null,
  originBoardId: sprint.originBoardId ?? null,
  goal: sprint.goal ?? null,
});

const JIRA_SOFTWARE_SPRINT_FIELD_SCHEMA =
  "com.pyxis.greenhopper.jira:gh-sprint";

const isSprintField = (field: JiraFieldPayload): boolean =>
  field.schema?.custom === JIRA_SOFTWARE_SPRINT_FIELD_SCHEMA &&
  field.schema.type === "array" &&
  field.schema.items === "json";

export const findJiraSprintFieldId = (
  fields: readonly JiraFieldPayload[],
): string | null => fields.find(isSprintField)?.id ?? null;

export const normalizeIssueSprintReferences = (
  issue: JiraIssuePayload,
  fieldCatalog: readonly JiraFieldPayload[],
): NormalizedJiraSprint[] => {
  const fieldId = findJiraSprintFieldId(fieldCatalog);
  if (!fieldId) return [];
  const value = issue.fields[fieldId];
  if (value === null || value === undefined) return [];
  const references = z
    .array(JiraSprintSchema)
    .parse(Array.isArray(value) ? value : [value]);
  return references.map(normalizeJiraSprint);
};
