import { type IssueMetadata, IssueMetadataSchema } from "@reef/core";
import { z } from "zod";
import { RawArchiveReferenceSchema } from "../archive/model.js";
import { deepFreeze } from "../shared/objects.js";

export { RawArchiveReferenceSchema } from "../archive/model.js";

export const JiraIssuePlanStatusSchema = z.enum([
  "ready",
  "ready_with_warnings",
  "blocked",
]);

export const JiraFieldResultClassificationSchema = z.enum([
  "mapped",
  "preserved",
  "deferred",
  "unsupported",
  "blocked",
]);

export const JiraIssueFieldResultSchema = z
  .object({
    sourceFieldId: z.string().min(1),
    sourceFieldName: z.string().min(1),
    targetField: z.string().nullable(),
    classification: JiraFieldResultClassificationSchema,
    reason: z.string().min(1),
    preservationLocation: z.string().nullable(),
  })
  .strict();

export const JiraIssueDeferredItemSchema = z
  .object({
    kind: z.enum([
      "parent",
      "relation",
      "release",
      "sprint",
      "description_media",
    ]),
    reason: z.enum([
      "needs_parent_reconcile",
      "cross_project_reconcile",
      "needs_relation_reconcile",
      "needs_release_mapping",
      "needs_sprint_mapping",
      "owner_decision_required",
      "needs_media_rewrite",
    ]),
    sourceKey: z.string().min(1),
    targetId: z.string().nullable(),
  })
  .strict();

export const JiraPlanningAssociationSchema = z
  .object({
    kind: z.enum(["version", "sprint"]),
    sourceKey: z.string().min(1),
    sourceId: z.string().min(1),
    name: z.string().nullable(),
    primary: z.boolean(),
    selectionReason: z.enum([
      "single_relation",
      "configured_primary",
      "owner_decision_required",
    ]),
    targetId: z.string().nullable(),
  })
  .strict();

export const JiraIssueImportPlanSchema = z
  .object({
    schema_version: z.literal(1),
    source: z
      .object({
        jiraCloudId: z.string().min(1),
        projectId: z.string().nullable(),
        projectKey: z.string().min(1),
        issueId: z.string().min(1),
        issueKey: z.string().min(1),
        issueUrl: z.string().nullable(),
        fieldCatalog: z
          .object({
            retrievedAt: z.string().datetime({ offset: true }),
            source: z.enum(["jira_field_api", "issue_expansion"]),
          })
          .strict(),
      })
      .strict(),
    desired: z
      .object({
        issue: IssueMetadataSchema.nullable(),
        content: z.string(),
      })
      .strict(),
    deferred: z.array(JiraIssueDeferredItemSchema),
    planning_associations: z.array(JiraPlanningAssociationSchema),
    field_results: z.array(JiraIssueFieldResultSchema),
    raw_preservation: z
      .object({
        compactPaths: z.array(z.string().min(1)),
        archiveReferences: z.array(
          z
            .object({
              kind: z.enum([
                "issue",
                "description_adf",
                "watcher_list",
                "custom_field",
                "media",
              ]),
              reference: RawArchiveReferenceSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    warnings: z.array(z.string()),
    status: JiraIssuePlanStatusSchema,
  })
  .strict();

export type JiraIssueImportPlan = z.infer<typeof JiraIssueImportPlanSchema>;
export type JiraIssueFieldResult = z.infer<typeof JiraIssueFieldResultSchema>;
export type JiraIssueDeferredItem = z.infer<typeof JiraIssueDeferredItemSchema>;
export type JiraPlanningAssociation = z.infer<
  typeof JiraPlanningAssociationSchema
>;

export const parseJiraIssueImportPlan = (value: unknown): JiraIssueImportPlan =>
  deepFreeze(JiraIssueImportPlanSchema.parse(value));

export type JiraIssueEventualWriteProjection = Omit<
  IssueMetadata,
  "created_at" | "updated_at"
>;

/**
 * Removes validation-only timestamps before REEF-321 projects the plan onto
 * AKB document/table writes. Jira source timestamps remain provenance only.
 */
export const projectJiraIssueEventualWrite = (
  issue: IssueMetadata,
): JiraIssueEventualWriteProjection => {
  const { created_at: _createdAt, updated_at: _updatedAt, ...write } = issue;
  return deepFreeze(write);
};
