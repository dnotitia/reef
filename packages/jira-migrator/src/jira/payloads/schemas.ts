import { z } from "zod";

const StringOrNumberAsStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

export const JiraCommentParentIdSchema = z
  .union([z.string().regex(/^\d+$/u), z.number().int().nonnegative().safe()])
  .transform((value) => BigInt(String(value)).toString());

const JiraCommentIdSchema = z
  .union([z.string(), z.number().int().nonnegative().safe()])
  .transform((value) => {
    const stringValue = String(value);
    return /^\d+$/u.test(stringValue)
      ? BigInt(stringValue).toString()
      : stringValue;
  });

const UnknownRecordSchema = z.record(z.unknown());

export const JiraProjectSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    key: z.string().min(1),
  })
  .passthrough();

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

const JiraLinkedIssueSchema = z
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
    id: JiraCommentIdSchema,
    parentId: JiraCommentParentIdSchema.nullable().optional(),
    body: z.unknown().optional(),
    renderedBody: z.string().optional(),
    author: JiraUserSchema.optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
    visibility: z
      .object({
        type: z.string().optional(),
        value: z.string().optional(),
        identifier: z.string().optional(),
      })
      .passthrough()
      .optional(),
    properties: z
      .array(
        z
          .object({
            key: z.string(),
            value: z.unknown(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const NullableOptionalStringSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);
const NullableOptionalRecordSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  UnknownRecordSchema.optional(),
);

export const JiraRemoteLinkSchema = z
  .object({
    id: z.preprocess(
      (value) => (value === null ? undefined : value),
      StringOrNumberAsStringSchema.optional(),
    ),
    globalId: NullableOptionalStringSchema,
    application: NullableOptionalRecordSchema,
    relationship: NullableOptionalStringSchema,
    object: z
      .object({
        url: NullableOptionalStringSchema,
        title: NullableOptionalStringSchema,
        summary: NullableOptionalStringSchema,
        icon: NullableOptionalRecordSchema,
        status: NullableOptionalRecordSchema,
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
// resolves to Object.prototype.toString during Zod object parsing. Copy the
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
