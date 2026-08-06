import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import { HttpUrlSchema } from "../common/url";

export const StatusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
]);

export const PriorityEnum = z.enum(["critical", "high", "medium", "low"]);

export const IssueTypeEnum = z.enum([
  "epic",
  "story",
  "task",
  "bug",
  "spike",
  "chore",
]);

export const SeverityEnum = z.enum([
  "blocker",
  "critical",
  "major",
  "minor",
  "trivial",
]);

export const ClosedReasonEnum = z.enum([
  "completed",
  "duplicate",
  "wont_fix",
  "invalid",
  "stale",
]);

// `document` was removed in REEF-083: akb document references are now modelled
// as akb-native `references` relation edges (see schemas/issues/references.ts),
// not opaque external_refs strings. Non-akb references
// (github/linear/slack/jira/confluence/url) stay here. older rows that still
// carry `{ type: "document" }` are folded into `other` on read by
// `ExternalRefSchema` below.
export const ExternalRefTypeEnum = z.enum([
  "github_issue",
  "linear",
  "slack",
  "jira",
  "confluence",
  "url",
  "other",
]);

export const ImplementationRefTypeEnum = z.enum([
  "pull_request",
  "commit",
  "branch",
]);

export const ExternalRefSchema = z
  .object({
    // A older `document` value is folded into `other` so a pre-REEF-083 row
    // still parses; the akb `references` edge, when present, is the real home
    // for document references. New writes does not emit `document`.
    type: z.preprocess(
      (value) => (value === "document" ? "other" : value),
      ExternalRefTypeEnum,
    ),
    ref: z.string().optional(),
    url: HttpUrlSchema.optional(),
    label: z.string().optional(),
  })
  .refine((ref) => ref.ref || ref.url, "ref or url is required");

export const ImplementationRefSchema = z.object({
  type: ImplementationRefTypeEnum,
  repo: z.string().optional(),
  ref: z.string().min(1),
  url: HttpUrlSchema.optional(),
  title: z.string().optional(),
  actor: z.string().optional(),
  detected_at: IsoDateFieldSchema.optional(),
});

export const IssueMetadataSchema = z.object({
  id: z.string().min(1, "id is required"),
  title: z.string().min(1, "title is required"),
  status: StatusEnum,
  created_at: IsoDateFieldSchema,
  created_by: z.string(),
  updated_at: IsoDateFieldSchema,
  updated_by: z.string(),

  issue_type: IssueTypeEnum.optional(),
  priority: PriorityEnum.nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  requester: z.string().nullable().optional(),
  reporter: z.string().nullable().optional(),
  start_date: IsoDateFieldSchema.nullable().optional(),
  due_date: IsoDateFieldSchema.nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  sprint_id: z.string().nullable().optional(),
  release_id: z.string().nullable().optional(),
  estimate_points: z.number().nonnegative().nullable().optional(),
  severity: SeverityEnum.nullable().optional(),
  rank: z.number().nullable().optional(),
  closed_at: IsoDateFieldSchema.nullable().optional(),
  closed_reason: ClosedReasonEnum.nullable().optional(),
  parent_id: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  related_to: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
  source: z.string().optional(),
  last_status_change: IsoDateFieldSchema.optional(),
  external_refs: z.array(ExternalRefSchema).optional(),
  implementation_refs: z.array(ImplementationRefSchema).optional(),
  watchers: z.array(z.string()).optional(),
  reviewers: z.array(z.string()).optional(),
  qa_owner: z.string().nullable().optional(),
  custom_fields: z.record(z.unknown()).optional(),
  archived_at: IsoDateFieldSchema.nullable().optional(),
});

export const IssueDocumentSchema = z
  .object({
    issue: IssueMetadataSchema,
    content: z.string(),
    /**
     * Git commit hash of the akb document at read time. The web edit form holds
     * it as the OCC base and echoes it back as `expected_commit` on save, so a
     * concurrent external edit to a document-projected field (body/title/labels/
     * relations) is rejected as a retryable conflict instead of silently
     * overwritten (REEF-227). Optional + nullable: akb may not return one, and
     * row consumers do not need it.
     */
    commit_hash: z.string().nullable().optional(),
  })
  .strict();

type IssueMetadataPickMask = Partial<
  Record<keyof z.infer<typeof IssueMetadataSchema>, true>
>;

function omitIssueMetadataPickFields<
  const TMask extends IssueMetadataPickMask,
  const TKey extends keyof TMask,
>(mask: TMask, keys: readonly TKey[]): Omit<TMask, TKey> {
  const next: Partial<TMask> = { ...mask };
  for (const key of keys) {
    delete next[key];
  }
  return next as Omit<TMask, TKey>;
}

const ISSUE_LIST_ITEM_FIELD_MASK = {
  id: true,
  title: true,
  status: true,
  created_at: true,
  created_by: true,
  updated_at: true,
  updated_by: true,
  issue_type: true,
  priority: true,
  assigned_to: true,
  requester: true,
  reporter: true,
  start_date: true,
  due_date: true,
  milestone_id: true,
  sprint_id: true,
  release_id: true,
  estimate_points: true,
  severity: true,
  rank: true,
  closed_at: true,
  closed_reason: true,
  parent_id: true,
  labels: true,
  depends_on: true,
  related_to: true,
  blocks: true,
  last_status_change: true,
  archived_at: true,
} as const satisfies IssueMetadataPickMask;

const ISSUE_MODEL_CONTEXT_FIELD_MASK = omitIssueMetadataPickFields(
  ISSUE_LIST_ITEM_FIELD_MASK,
  ["created_at", "created_by", "updated_at", "updated_by"] as const,
);

export const IssueListItemSchema = IssueMetadataSchema.pick(
  ISSUE_LIST_ITEM_FIELD_MASK,
);

export const IssueSearchResultMetadataSchema = IssueMetadataSchema.pick(
  ISSUE_MODEL_CONTEXT_FIELD_MASK,
);

export const SimilarIssueSchema = IssueSearchResultMetadataSchema.extend({
  matched_section: z.string().nullable().optional(),
  score: z.number(),
});

export const IssueCreateFieldsSchema = IssueMetadataSchema.pick({
  title: true,
  issue_type: true,
  priority: true,
  assigned_to: true,
  requester: true,
  reporter: true,
  start_date: true,
  due_date: true,
  milestone_id: true,
  sprint_id: true,
  release_id: true,
  estimate_points: true,
  severity: true,
  // `rank` is deliberately NOT a create field: product create flows do not
  // hand-author ordering. The backlog drag-reorder endpoint and trusted import
  // paths own writes to the issue-wide numeric ordering scalar (REEF-129/393).
  parent_id: true,
  labels: true,
  depends_on: true,
  related_to: true,
  blocks: true,
  external_refs: true,
  implementation_refs: true,
})
  .extend({
    // New issues land in `backlog` by default (REEF-130). The create input may
    // carry an explicit status so the AI activity-scan draft path can persist a
    // code-signal-inferred status; the human create path omits it and inherits
    // the default in `buildIssueMetadataFromCreateInput`. `closed` is excluded
    // here: closing requires a reason and timestamp via the dedicated close
    // flow, so a create should not persist a closed issue at this trust
    // boundary.
    status: StatusEnum.exclude(["closed"]).optional(),
  })
  .strict();

export const IssueCreateInputSchema = z
  .object({
    fields: IssueCreateFieldsSchema,
    content: z.string(),
  })
  .strict();

export const IssueUpdatePatchSchema = IssueMetadataSchema.pick({
  title: true,
  status: true,
  issue_type: true,
  priority: true,
  assigned_to: true,
  requester: true,
  reporter: true,
  start_date: true,
  due_date: true,
  milestone_id: true,
  sprint_id: true,
  release_id: true,
  estimate_points: true,
  severity: true,
  // `rank` is intentionally NOT updatable here: the issue-wide numeric ordering
  // scalar is owned by the atomic, backlog-scoped reorder endpoint and trusted
  // import paths (REEF-129/393). Allowing it on generic PATCH would bypass those
  // ownership guards.
  closed_reason: true,
  parent_id: true,
  labels: true,
  depends_on: true,
  related_to: true,
  blocks: true,
  external_refs: true,
  implementation_refs: true,
  watchers: true,
  reviewers: true,
  qa_owner: true,
  custom_fields: true,
  archived_at: true,
})
  .partial()
  .strict();

export const IssueUpdateInputSchema = z
  .object({
    issue_id: z.string().min(1),
    patch: IssueUpdatePatchSchema,
    content: z.string().optional(),
    /**
     * OCC base — the akb document `commit_hash` the edit was made against. When
     * the edit touches the document (body/title/labels/relations) `updateIssue`
     * forwards it as akb's `expected_commit` precondition; a moved commit is
     * rejected as a retryable `ConflictError` (REEF-227). Omitted for row-scoped
     * edits, which stay last-write-wins.
     */
    expected_commit: z.string().optional(),
  })
  .strict();

export const IssueChangeProposalSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("create"),
      create: IssueCreateInputSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      update: IssueUpdateInputSchema,
    })
    .strict(),
]);

export type IssueMetadata = z.infer<typeof IssueMetadataSchema>;
export type IssueDocument = z.infer<typeof IssueDocumentSchema>;
export type IssueListItem = z.infer<typeof IssueListItemSchema>;
export type SimilarIssue = z.infer<typeof SimilarIssueSchema>;
export type IssueCreateFields = z.infer<typeof IssueCreateFieldsSchema>;
export type IssueCreateInput = z.infer<typeof IssueCreateInputSchema>;
export type IssueUpdatePatch = z.infer<typeof IssueUpdatePatchSchema>;
export type IssueUpdateInput = z.infer<typeof IssueUpdateInputSchema>;
export type Status = z.infer<typeof StatusEnum>;
export type Priority = z.infer<typeof PriorityEnum>;
export type IssueType = z.infer<typeof IssueTypeEnum>;
export type Severity = z.infer<typeof SeverityEnum>;
export type ClosedReason = z.infer<typeof ClosedReasonEnum>;
export type ExternalRef = z.infer<typeof ExternalRefSchema>;
export type ImplementationRef = z.infer<typeof ImplementationRefSchema>;
