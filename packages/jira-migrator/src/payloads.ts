import { z } from "zod";

const StringOrNumberAsStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

export const JiraCommentParentIdSchema = z
  .union([z.string().regex(/^\d+$/u), z.number().int().nonnegative().safe()])
  .transform((value) => BigInt(String(value)).toString());

const UnknownRecordSchema = z.record(z.unknown());

export const JiraUserSchema = z
  .object({
    accountId: z.string().optional(),
    displayName: z.string().optional(),
    emailAddress: z.string().optional(),
    active: z.boolean().optional(),
    accountType: z.string().optional(),
  })
  .passthrough();

export const JiraAttachmentSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    filename: z.string(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    content: z.string().optional(),
    created: z.string().optional(),
    author: JiraUserSchema.optional(),
  })
  .passthrough();

export const JiraLinkedIssueSchema = z
  .object({
    id: StringOrNumberAsStringSchema.optional(),
    key: z.string(),
    fields: UnknownRecordSchema.optional(),
  })
  .passthrough();

export const JiraIssueLinkSchema = z
  .object({
    id: StringOrNumberAsStringSchema.optional(),
    type: z
      .object({
        id: StringOrNumberAsStringSchema.optional(),
        name: z.string().optional(),
        inward: z.string().optional(),
        outward: z.string().optional(),
      })
      .passthrough()
      .optional(),
    inwardIssue: JiraLinkedIssueSchema.optional(),
    outwardIssue: JiraLinkedIssueSchema.optional(),
  })
  .passthrough();

export const JiraIssueSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    key: z.string(),
    self: z.string().optional(),
    fields: z
      .object({
        summary: z.string().optional(),
        description: z.unknown().optional(),
        created: z.string().optional(),
        updated: z.string().optional(),
        labels: z.array(z.string()).optional(),
        project: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            key: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        issuetype: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            name: z.string().optional(),
            subtask: z.boolean().optional(),
            hierarchyLevel: z.number().int().optional(),
          })
          .passthrough()
          .optional(),
        status: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            name: z.string().optional(),
            statusCategory: z
              .object({
                id: StringOrNumberAsStringSchema.optional(),
                key: z.string().optional(),
                name: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
        assignee: JiraUserSchema.nullable().optional(),
        reporter: JiraUserSchema.nullable().optional(),
        creator: JiraUserSchema.nullable().optional(),
        priority: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        duedate: z.string().nullable().optional(),
        resolution: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        resolutiondate: z.string().nullable().optional(),
        parent: JiraLinkedIssueSchema.nullable().optional(),
        fixVersions: z.array(z.record(z.unknown())).optional(),
        versions: z.array(z.record(z.unknown())).optional(),
        components: z.array(z.record(z.unknown())).optional(),
        environment: z.unknown().optional(),
        watches: z.record(z.unknown()).optional(),
        votes: z.record(z.unknown()).optional(),
        timetracking: z.record(z.unknown()).optional(),
        worklog: z.record(z.unknown()).optional(),
        attachment: z.array(JiraAttachmentSchema).optional(),
        issuelinks: z.array(JiraIssueLinkSchema).optional(),
      })
      .passthrough(),
    renderedFields: UnknownRecordSchema.optional(),
  })
  .passthrough();

export const JiraSearchResponseSchema = z
  .object({
    issues: z.array(JiraIssueSchema),
    nextPageToken: z.string().optional(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const JiraVersionSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    projectId: StringOrNumberAsStringSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    startDate: z.string().optional(),
    releaseDate: z.string().optional(),
    released: z.boolean().default(false),
    archived: z.boolean().default(false),
  })
  .passthrough();

export const JiraVersionPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    isLast: z.boolean().optional(),
    values: z.array(JiraVersionSchema),
  })
  .passthrough();

export const JiraSprintSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    state: z.string(),
    name: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    completeDate: z.string().optional(),
    originBoardId: StringOrNumberAsStringSchema.optional(),
    goal: z.string().optional(),
  })
  .passthrough();

export const JiraSprintPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    isLast: z.boolean().optional(),
    values: z.array(JiraSprintSchema),
  })
  .passthrough();

export const JiraFieldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    custom: z.boolean().optional(),
    clauseNames: z.array(z.string()).default([]),
    schema: z
      .object({
        type: z.string().optional(),
        items: z.string().optional(),
        custom: z.string().optional(),
        customId: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const JiraFieldCatalogSchema = z.array(JiraFieldSchema);

export const JiraCommentSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    parentId: JiraCommentParentIdSchema.nullable().optional(),
    body: z.unknown().optional(),
    renderedBody: z.string().optional(),
    author: JiraUserSchema.optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
  })
  .passthrough();

export const JiraRemoteLinkSchema = z
  .object({
    id: StringOrNumberAsStringSchema.optional(),
    globalId: z.string().optional(),
    application: UnknownRecordSchema.optional(),
    relationship: z.string().optional(),
    object: z
      .object({
        url: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        icon: UnknownRecordSchema.optional(),
        status: UnknownRecordSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const JiraRemoteLinkListSchema = z.array(JiraRemoteLinkSchema);

export const JiraCommentPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    comments: z.array(JiraCommentSchema),
  })
  .passthrough();

const JiraChangelogItemObjectSchema = z
  .object({
    field: z.string().min(1),
    fieldId: z.string().nullable().optional(),
    fieldtype: z.string().nullable().optional(),
    from: StringOrNumberAsStringSchema.nullable().optional(),
    to: StringOrNumberAsStringSchema.nullable().optional(),
    fromString: z.string().nullable().optional(),
    toString: z.string().nullable().optional(),
  })
  .passthrough();

// `toString` is a real Jira wire field, but an omitted property otherwise
// resolves to Object.prototype.toString during Zod object parsing. Copy only
// own enumerable fields onto a null-prototype object before validation so an
// omitted Jira value stays omitted.
export const JiraChangelogItemSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.assign(Object.create(null), value);
}, JiraChangelogItemObjectSchema);

export const JiraChangelogHistorySchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    author: JiraUserSchema.optional(),
    created: z.string().optional(),
    items: z.array(JiraChangelogItemSchema).default([]),
  })
  .passthrough();

export const JiraChangelogPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    isLast: z.boolean().optional(),
    values: z.array(JiraChangelogHistorySchema),
  })
  .passthrough();

export type JiraAttachmentPayload = z.infer<typeof JiraAttachmentSchema>;
export type JiraIssueLinkPayload = z.infer<typeof JiraIssueLinkSchema>;
export type JiraIssuePayload = z.infer<typeof JiraIssueSchema>;
export type JiraUserPayload = z.infer<typeof JiraUserSchema>;
export type JiraSearchResponsePayload = z.infer<
  typeof JiraSearchResponseSchema
>;
export type JiraVersionPayload = z.infer<typeof JiraVersionSchema>;
export type JiraVersionPagePayload = z.infer<typeof JiraVersionPageSchema>;
export type JiraSprintPayload = z.infer<typeof JiraSprintSchema>;
export type JiraSprintPagePayload = z.infer<typeof JiraSprintPageSchema>;
export type JiraFieldPayload = z.infer<typeof JiraFieldSchema>;
export type JiraCommentPayload = z.infer<typeof JiraCommentSchema>;
export type JiraCommentPagePayload = z.infer<typeof JiraCommentPageSchema>;
export type JiraRemoteLinkPayload = z.infer<typeof JiraRemoteLinkSchema>;
export type JiraChangelogItemPayload = z.infer<typeof JiraChangelogItemSchema>;
export type JiraChangelogHistoryPayload = z.infer<
  typeof JiraChangelogHistorySchema
>;
export type JiraChangelogPagePayload = z.infer<typeof JiraChangelogPageSchema>;

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
