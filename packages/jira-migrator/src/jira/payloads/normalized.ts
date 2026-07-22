import type { JiraIssuePayload, JiraUserPayload } from "./schemas.js";

export interface NormalizedJiraAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  contentUrl: string | null;
  created: string | null;
  author: NormalizedJiraUser | null;
}

export interface NormalizedJiraIssueLink {
  id: string | null;
  typeId: string | null;
  type: string | null;
  inward: string | null;
  outward: string | null;
  direction: "inward" | "outward";
  issueKey: string;
  issueId: string | null;
  label: string | null;
}

export interface NormalizedJiraUser {
  accountId: string | null;
  emailAddress: string | null;
  displayName: string | null;
  active: boolean | null;
  accountType: string | null;
  raw: JiraUserPayload;
}

export interface NormalizedJiraIssue {
  id: string;
  key: string;
  summary: string;
  projectKey: string | null;
  issueType: string | null;
  issueTypeId: string | null;
  issueTypeSubtask: boolean;
  issueTypeHierarchyLevel: number | null;
  status: string | null;
  statusId: string | null;
  statusCategoryKey: string | null;
  statusCategoryName: string | null;
  description: unknown;
  priority: { id: string | null; name: string | null } | null;
  dueDate: string | null;
  resolution: { id: string | null; name: string | null } | null;
  resolutionDate: string | null;
  parent: { id: string | null; key: string } | null;
  fixVersions: ReadonlyArray<Record<string, unknown>>;
  affectedVersions: ReadonlyArray<Record<string, unknown>>;
  components: ReadonlyArray<Record<string, unknown>>;
  environment: unknown;
  watches: Readonly<Record<string, unknown>> | null;
  votes: Readonly<Record<string, unknown>> | null;
  timetracking: Readonly<Record<string, unknown>> | null;
  worklog: Readonly<Record<string, unknown>> | null;
  created: string | null;
  updated: string | null;
  labels: string[];
  attachments: NormalizedJiraAttachment[];
  links: NormalizedJiraIssueLink[];
  users: {
    assignee: NormalizedJiraUser | null;
    reporter: NormalizedJiraUser | null;
    creator: NormalizedJiraUser | null;
  };
  raw: JiraIssuePayload;
}

export interface NormalizedJiraVersion {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  startDate: string | null;
  releaseDate: string | null;
  released: boolean;
  archived: boolean;
}

export interface NormalizedJiraSprint {
  id: string;
  state: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  originBoardId: string | null;
  goal: string | null;
}
