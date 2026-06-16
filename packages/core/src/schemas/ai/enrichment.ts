import { z } from "zod";
import {
  ExternalRefSchema,
  IssueCreateInputSchema,
  type IssueMetadata,
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
} from "../issues/metadata";
import { AKB_DOCUMENT_URI_RE } from "../issues/references";
import { PlanningCatalogSchema } from "../planning/catalog";
import { CollaboratorSchema } from "../workspace/collaborator";
import { VaultNameSchema } from "../workspace/config";

/**
 * Output schemas for AI-assisted issue enrichment.
 *
 * Mirrors the Tauri-era enrichment types ported to the web track.
 * Each suggestion is a discriminated union over the field it targets so the
 * `value` payload can be type-checked at parse time — string for scalar fields,
 * string[] for collection fields. The LLM is instructed (in
 * `buildEnrichmentSystemPrompt`) to return JSON in exactly this shape.
 */

export const EnrichmentFieldEnum = z.enum([
  "title",
  "content",
  "issue_type",
  "priority",
  "assigned_to",
  "requester",
  "reporter",
  "start_date",
  "due_date",
  "milestone_id",
  "sprint_id",
  "release_id",
  "estimate_points",
  "severity",
  "parent_id",
  "labels",
  "depends_on",
  "blocks",
  "related_to",
  "external_refs",
]);
export type EnrichmentField = z.infer<typeof EnrichmentFieldEnum>;

// Compile-time subset guard: every enrichable field (except `content`, which
// lives on IssueDocument, not the metadata row) should be a real IssueMetadata
// key — a field rename in metadata.ts then breaks the build here instead of
// silently drifting. Do NOT derive this enum from IssueMetadataSchema.keyof():
// that would drop `content` and pull in ~17 non-enrichable system/audit fields.
EnrichmentFieldEnum.options satisfies readonly (
  | keyof IssueMetadata
  | "content"
)[];

const ConfidenceSchema = z.number().min(0).max(1);

const TitleSuggestionSchema = z.object({
  field: z.literal("title"),
  value: z.string().min(1).max(200),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const ContentSuggestionSchema = z.object({
  field: z.literal("content"),
  value: z.string().min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const IssueTypeSuggestionSchema = z.object({
  field: z.literal("issue_type"),
  value: IssueTypeEnum,
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const PrioritySuggestionSchema = z.object({
  field: z.literal("priority"),
  value: PriorityEnum,
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const ScalarStringSuggestionSchema = <TField extends string>(field: TField) =>
  z.object({
    field: z.literal(field),
    value: z.string().min(1),
    reasoning: z.string().min(1).max(200),
    confidence: ConfidenceSchema,
  });

const AssignedToSuggestionSchema = z.object({
  field: z.literal("assigned_to"),
  value: z.string().min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const EstimatePointsSuggestionSchema = z.object({
  field: z.literal("estimate_points"),
  value: z.number().nonnegative(),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const SeveritySuggestionSchema = z.object({
  field: z.literal("severity"),
  value: SeverityEnum,
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const LabelsSuggestionSchema = z.object({
  field: z.literal("labels"),
  value: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const DependsOnSuggestionSchema = z.object({
  field: z.literal("depends_on"),
  value: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const BlocksSuggestionSchema = z.object({
  field: z.literal("blocks"),
  value: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const RelatedToSuggestionSchema = z.object({
  field: z.literal("related_to"),
  value: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

const ExternalRefsSuggestionSchema = z.object({
  field: z.literal("external_refs"),
  value: z.array(ExternalRefSchema).min(1),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});

export const EnrichmentSuggestionSchema = z.discriminatedUnion("field", [
  TitleSuggestionSchema,
  ContentSuggestionSchema,
  IssueTypeSuggestionSchema,
  PrioritySuggestionSchema,
  AssignedToSuggestionSchema,
  ScalarStringSuggestionSchema("requester"),
  ScalarStringSuggestionSchema("reporter"),
  ScalarStringSuggestionSchema("start_date"),
  ScalarStringSuggestionSchema("due_date"),
  ScalarStringSuggestionSchema("milestone_id"),
  ScalarStringSuggestionSchema("sprint_id"),
  ScalarStringSuggestionSchema("release_id"),
  EstimatePointsSuggestionSchema,
  SeveritySuggestionSchema,
  ScalarStringSuggestionSchema("parent_id"),
  LabelsSuggestionSchema,
  DependsOnSuggestionSchema,
  BlocksSuggestionSchema,
  RelatedToSuggestionSchema,
  ExternalRefsSuggestionSchema,
]);
export type EnrichmentSuggestion = z.infer<typeof EnrichmentSuggestionSchema>;

/**
 * A supporting akb document the AI proposes linking to the issue as a
 * first-class `references` relation (REEF-083 AC4). Kept separate from
 * suggestions: a reference is NOT an issue metadata field, so it does not be a
 * suggestion (whose `field` should be a metadata key — see the satisfies guard
 * above). It is applied via the relation API on approval, not as a field patch.
 */
export const ReferenceSuggestionSchema = z.object({
  uri: z.string().regex(AKB_DOCUMENT_URI_RE, "must be an akb document URI"),
  // nullable: search_documents returns `title: null` for an akb hit with no
  // title, and the model may copy that through verbatim. Rejecting null would
  // silently drop an otherwise-usable document reference.
  title: z.string().nullable().optional(),
  reasoning: z.string().min(1).max(200),
  confidence: ConfidenceSchema,
});
export type ReferenceSuggestion = z.infer<typeof ReferenceSuggestionSchema>;

export const EnrichmentResultSchema = z.object({
  suggestions: z.array(EnrichmentSuggestionSchema),
  references: z.array(ReferenceSuggestionSchema).default([]),
});
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;

export const EnrichmentDraftSchema = IssueCreateInputSchema;

export const EnrichmentRepoContextSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type EnrichmentRepoContext = z.infer<typeof EnrichmentRepoContextSchema>;

export const EnrichmentLabelContextSchema = z.object({
  name: z.string().min(1),
  issue_count: z.number().int().nonnegative(),
  template_count: z.number().int().nonnegative(),
});
export type EnrichmentLabelContext = z.infer<
  typeof EnrichmentLabelContextSchema
>;

export const EnrichmentTemplateSummarySchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  title_prefix: z.string().optional(),
  priority: PriorityEnum.optional(),
  default_labels: z.array(z.string()),
});

export const EnrichmentContextSchema = z.object({
  labels: z.array(EnrichmentLabelContextSchema).default([]),
  members: z.array(CollaboratorSchema).default([]),
  planningCatalog: PlanningCatalogSchema.optional(),
  templates: z.array(EnrichmentTemplateSummarySchema).default([]),
  knownIssueIds: z.array(z.string()).default([]),
});
export type EnrichmentContext = z.infer<typeof EnrichmentContextSchema>;

/** Input schema for the enrichment route. */
export const EnrichmentRequestSchema = z.object({
  issueId: z.string().min(1),
  vault: VaultNameSchema,
  draft: EnrichmentDraftSchema,
  repoContext: EnrichmentRepoContextSchema.optional(),
});
export type EnrichmentRequest = z.infer<typeof EnrichmentRequestSchema>;
