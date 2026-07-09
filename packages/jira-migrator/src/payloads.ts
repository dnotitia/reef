import { z } from "zod";

const StringOrNumberAsStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

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
          })
          .passthrough()
          .optional(),
        status: z
          .object({
            id: StringOrNumberAsStringSchema.optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        assignee: JiraUserSchema.nullable().optional(),
        reporter: JiraUserSchema.nullable().optional(),
        attachment: z.array(JiraAttachmentSchema).optional(),
        issuelinks: z.array(JiraIssueLinkSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const JiraSearchResponseSchema = z
  .object({
    issues: z.array(JiraIssueSchema),
    nextPageToken: z.string().optional(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const JiraCommentSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    body: z.unknown().optional(),
    author: JiraUserSchema.optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
  })
  .passthrough();

export const JiraCommentPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    comments: z.array(JiraCommentSchema),
  })
  .passthrough();

export const JiraChangelogItemSchema = z
  .object({
    id: StringOrNumberAsStringSchema,
    author: JiraUserSchema.optional(),
    created: z.string().optional(),
    items: z.array(UnknownRecordSchema).default([]),
  })
  .passthrough();

export const JiraChangelogPageSchema = z
  .object({
    startAt: z.number().int().nonnegative().default(0),
    maxResults: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
    isLast: z.boolean().optional(),
    values: z.array(JiraChangelogItemSchema),
  })
  .passthrough();

export type JiraAttachmentPayload = z.infer<typeof JiraAttachmentSchema>;
export type JiraIssueLinkPayload = z.infer<typeof JiraIssueLinkSchema>;
export type JiraIssuePayload = z.infer<typeof JiraIssueSchema>;
export type JiraUserPayload = z.infer<typeof JiraUserSchema>;
export type JiraSearchResponsePayload = z.infer<
  typeof JiraSearchResponseSchema
>;
export type JiraCommentPayload = z.infer<typeof JiraCommentSchema>;
export type JiraCommentPagePayload = z.infer<typeof JiraCommentPageSchema>;
export type JiraChangelogItemPayload = z.infer<typeof JiraChangelogItemSchema>;
export type JiraChangelogPagePayload = z.infer<typeof JiraChangelogPageSchema>;

export interface NormalizedJiraAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  contentUrl: string | null;
  created: string | null;
}

export interface NormalizedJiraIssueLink {
  id: string | null;
  type: string | null;
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
  status: string | null;
  created: string | null;
  updated: string | null;
  labels: string[];
  attachments: NormalizedJiraAttachment[];
  links: NormalizedJiraIssueLink[];
  users: {
    assignee: NormalizedJiraUser | null;
    reporter: NormalizedJiraUser | null;
  };
  raw: JiraIssuePayload;
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
});

export const normalizeJiraIssueLink = (
  link: JiraIssueLinkPayload,
): NormalizedJiraIssueLink | null => {
  const direction = link.inwardIssue ? "inward" : "outward";
  const issue = link.inwardIssue ?? link.outwardIssue;
  if (!issue) return null;

  return {
    id: link.id ?? null,
    type: link.type?.name ?? null,
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
  status: issue.fields.status?.name ?? null,
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
  },
  raw: issue,
});
