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

const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const JiraProjectSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  key: z.string().min(1),
});

export const JiraUserSchema = z.looseObject({
  accountId: z.string().optional(),
  displayName: z.string().optional(),
  emailAddress: z.string().optional(),
  active: z.boolean().optional(),
  accountType: z.string().optional(),
});

export const JiraAttachmentSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  filename: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  created: z.string().optional(),
  author: JiraUserSchema.optional(),
});

const JiraLinkedIssueSchema = z.looseObject({
  id: StringOrNumberAsStringSchema.optional(),
  key: z.string(),
  fields: UnknownRecordSchema.optional(),
});

export const JiraIssueLinkSchema = z.looseObject({
  id: StringOrNumberAsStringSchema.optional(),
  type: z
    .looseObject({
      id: StringOrNumberAsStringSchema.optional(),
      name: z.string().optional(),
      inward: z.string().optional(),
      outward: z.string().optional(),
    })
    .optional(),
  inwardIssue: JiraLinkedIssueSchema.optional(),
  outwardIssue: JiraLinkedIssueSchema.optional(),
});

export const JiraIssueSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  key: z.string(),
  self: z.string().optional(),
  fields: z.looseObject({
    summary: z.string().optional(),
    description: z.unknown().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
    labels: z.array(z.string()).optional(),
    project: z
      .looseObject({
        id: StringOrNumberAsStringSchema.optional(),
        key: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    issuetype: z
      .looseObject({
        id: StringOrNumberAsStringSchema.optional(),
        name: z.string().optional(),
        subtask: z.boolean().optional(),
        hierarchyLevel: z.number().int().optional(),
      })
      .optional(),
    status: z
      .looseObject({
        id: StringOrNumberAsStringSchema.optional(),
        name: z.string().optional(),
        statusCategory: z
          .looseObject({
            id: StringOrNumberAsStringSchema.optional(),
            key: z.string().optional(),
            name: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    assignee: JiraUserSchema.nullable().optional(),
    reporter: JiraUserSchema.nullable().optional(),
    creator: JiraUserSchema.nullable().optional(),
    priority: z
      .looseObject({
        id: StringOrNumberAsStringSchema.optional(),
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    duedate: z.string().nullable().optional(),
    resolution: z
      .looseObject({
        id: StringOrNumberAsStringSchema.optional(),
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    resolutiondate: z.string().nullable().optional(),
    parent: JiraLinkedIssueSchema.nullable().optional(),
    fixVersions: z.array(z.record(z.string(), z.unknown())).optional(),
    versions: z.array(z.record(z.string(), z.unknown())).optional(),
    components: z.array(z.record(z.string(), z.unknown())).optional(),
    environment: z.unknown().optional(),
    watches: z.record(z.string(), z.unknown()).optional(),
    votes: z.record(z.string(), z.unknown()).optional(),
    timetracking: z.record(z.string(), z.unknown()).optional(),
    worklog: z.record(z.string(), z.unknown()).optional(),
    attachment: z.array(JiraAttachmentSchema).optional(),
    issuelinks: z.array(JiraIssueLinkSchema).optional(),
  }),
  renderedFields: UnknownRecordSchema.optional(),
});

export const JiraSearchResponseSchema = z.looseObject({
  issues: z.array(JiraIssueSchema),
  nextPageToken: z.string().optional(),
  isLast: z.boolean().optional(),
});

export const JiraVersionSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  projectId: StringOrNumberAsStringSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().optional(),
  releaseDate: z.string().optional(),
  released: z.boolean().default(false),
  archived: z.boolean().default(false),
});

export const JiraVersionPageSchema = z.looseObject({
  startAt: z.number().int().nonnegative().default(0),
  maxResults: z.number().int().positive(),
  total: z.number().int().nonnegative().optional(),
  isLast: z.boolean().optional(),
  values: z.array(JiraVersionSchema),
});

export const JiraSprintSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  state: z.string(),
  name: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  completeDate: z.string().optional(),
  originBoardId: StringOrNumberAsStringSchema.optional(),
  goal: z.string().optional(),
});

export const JiraBoardSchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  name: z.string().min(1),
  type: z.string().min(1),
  location: UnknownRecordSchema.optional(),
});

export const JiraSprintPageSchema = z.looseObject({
  startAt: z.number().int().nonnegative().default(0),
  maxResults: z.number().int().positive(),
  total: z.number().int().nonnegative().optional(),
  isLast: z.boolean().optional(),
  values: z.array(JiraSprintSchema),
});

export const JiraFieldSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  custom: z.boolean().optional(),
  clauseNames: z.array(z.string()).default([]),
  schema: z
    .looseObject({
      type: z.string().optional(),
      items: z.string().optional(),
      custom: z.string().optional(),
      customId: z.number().optional(),
    })
    .optional(),
});

export const JiraFieldCatalogSchema = z.array(JiraFieldSchema);

export const JiraCommentSchema = z.looseObject({
  id: JiraCommentIdSchema,
  parentId: JiraCommentParentIdSchema.nullable().optional(),
  body: z.unknown().optional(),
  renderedBody: z.string().optional(),
  author: JiraUserSchema.optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  visibility: z
    .looseObject({
      type: z.string().optional(),
      value: z.string().optional(),
      identifier: z.string().optional(),
    })
    .optional(),
  properties: z
    .array(
      z.looseObject({
        key: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
});

const NullableOptionalStringSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);
const NullableOptionalRecordSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  UnknownRecordSchema.optional(),
);

export const JiraRemoteLinkSchema = z.looseObject({
  id: z.preprocess(
    (value) => (value === null ? undefined : value),
    StringOrNumberAsStringSchema.optional(),
  ),
  globalId: NullableOptionalStringSchema,
  application: NullableOptionalRecordSchema,
  relationship: NullableOptionalStringSchema,
  object: z.looseObject({
    url: NullableOptionalStringSchema,
    title: NullableOptionalStringSchema,
    summary: NullableOptionalStringSchema,
    icon: NullableOptionalRecordSchema,
    status: NullableOptionalRecordSchema,
  }),
});

export const JiraRemoteLinkListSchema = z.array(JiraRemoteLinkSchema);

export const JiraCommentPageSchema = z.looseObject({
  startAt: z.number().int().nonnegative().default(0),
  maxResults: z.number().int().positive(),
  total: z.number().int().nonnegative().optional(),
  comments: z.array(JiraCommentSchema),
});

const JiraChangelogItemObjectSchema = z.looseObject({
  field: z.string().min(1),
  fieldId: z.string().nullable().optional(),
  fieldtype: z.string().nullable().optional(),
  from: StringOrNumberAsStringSchema.nullable().optional(),
  to: StringOrNumberAsStringSchema.nullable().optional(),
  fromString: z.string().nullable().optional(),
  toString: z.string().nullable().optional(),
});

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

export const JiraChangelogHistorySchema = z.looseObject({
  id: StringOrNumberAsStringSchema,
  author: JiraUserSchema.optional(),
  created: z.string().optional(),
  items: z.array(JiraChangelogItemSchema).default([]),
});

export const JiraChangelogPageSchema = z.looseObject({
  startAt: z.number().int().nonnegative().default(0),
  maxResults: z.number().int().positive(),
  total: z.number().int().nonnegative().optional(),
  isLast: z.boolean().optional(),
  values: z.array(JiraChangelogHistorySchema),
});

export type JiraAttachmentPayload = z.infer<typeof JiraAttachmentSchema>;
export type JiraIssueLinkPayload = z.infer<typeof JiraIssueLinkSchema>;
export type JiraIssuePayload = z.infer<typeof JiraIssueSchema>;
export type JiraUserPayload = z.infer<typeof JiraUserSchema>;
export type JiraSearchResponsePayload = z.infer<
  typeof JiraSearchResponseSchema
>;
export type JiraVersionPayload = z.infer<typeof JiraVersionSchema>;
export type JiraVersionPagePayload = z.infer<typeof JiraVersionPageSchema>;
export type JiraBoardPayload = z.infer<typeof JiraBoardSchema>;
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
