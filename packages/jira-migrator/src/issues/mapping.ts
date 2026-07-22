import {
  type ClosedReason,
  ClosedReasonEnum,
  type IssueMetadata,
  IssueMetadataSchema,
  type IssueType,
  IssueTypeEnum,
  type Priority,
  PriorityEnum,
  type Status,
  StatusEnum,
} from "@reef/core";
import {
  type JiraAccountMappingArtifact,
  type ReefActorDirectoryEntry,
  createJiraAccountMappingArtifact,
  mapJiraIssueActors,
} from "../accounts/mapping.js";
import type { RawArchiveReference } from "../archive/model.js";
import { convertAdfToMarkdown } from "../content/adf.js";
import {
  type JiraCanonicalFieldRole,
  type JiraFieldCatalogSnapshot,
  type JiraFieldOverrides,
  type JiraFieldResolution,
  resolveJiraFields,
} from "../jira/fieldCatalog.js";
import {
  type JiraIssuePayload,
  JiraIssueSchema,
  JiraSprintSchema,
  normalizeJiraIssue,
} from "../payloads.js";
import type { JiraPlanningTargetMappings } from "../planning/entities.js";
import {
  jiraSprintSourceIdentity,
  jiraVersionSourceIdentity,
} from "../planning/entities.js";
import type { JiraRankImportPlan } from "../planning/rank.js";
import { deepFreeze, mergeJiraCustomFields } from "../shared/objects.js";
import {
  type JiraIssueDeferredItem,
  type JiraIssueFieldResult,
  type JiraIssueImportPlan,
  type JiraPlanningAssociation,
  parseJiraIssueImportPlan,
} from "./importPlan.js";

import {
  asString,
  catalogFieldResult,
  fieldResult,
  knownFieldKeys,
  safeUrl,
} from "./fieldResults.js";
import type {
  BuildJiraIssueImportPlanInput,
  JiraIssueMappingPolicy,
  JiraIssueRawArchiveReferences,
  JiraIssueTypeMappingRule,
  JiraPriorityMappingRule,
  JiraStatusMappingRule,
} from "./mappingContracts.js";
import {
  resolveIssueType,
  resolvePriority,
  resolveStatus,
} from "./mappingPolicy.js";
import { planAssociations } from "./planningAssociations.js";

export type {
  BuildJiraIssueImportPlanInput,
  JiraIssueMappingPolicy,
  JiraIssueRawArchiveReferences,
  JiraIssueTypeMappingRule,
  JiraPriorityMappingRule,
  JiraStatusMappingRule,
} from "./mappingContracts.js";

export const buildJiraIssueImportPlan = (
  input: BuildJiraIssueImportPlanInput,
): JiraIssueImportPlan => {
  const parsedIssue = JiraIssueSchema.parse(input.issue);
  const issue = normalizeJiraIssue(parsedIssue);
  const fieldResolutions = resolveJiraFields(
    input.fieldCatalog,
    input.fieldOverrides,
  );
  const fieldResults: JiraIssueFieldResult[] = [
    fieldResult("summary", "Summary", "title", "mapped", "summary_to_title"),
    ...Object.entries(fieldResolutions).map(([role, result]) =>
      catalogFieldResult(role as JiraCanonicalFieldRole, result),
    ),
  ];
  const deferred: JiraIssueDeferredItem[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const accountMappingMatchesCloud =
    input.accountMapping.artifact.jiraCloudId === input.jiraCloudId;
  const safeAccountMapping = accountMappingMatchesCloud
    ? input.accountMapping
    : {
        artifact: createJiraAccountMappingArtifact({
          jiraCloudId: input.jiraCloudId,
        }),
      };

  if (!accountMappingMatchesCloud) {
    blockers.push("account_mapping_cloud_mismatch");
    fieldResults.push(
      fieldResult(
        "account_mapping",
        "Jira account mapping",
        null,
        "blocked",
        "account_mapping_cloud_mismatch",
      ),
    );
  }

  if (!input.rawArchiveReferences.issue) {
    blockers.push("raw_archive_reference_missing:issue");
    fieldResults.push(
      fieldResult(
        "*",
        "Raw Jira issue",
        null,
        "blocked",
        "raw_archive_reference_missing",
        "raw_preservation.archiveReferences",
      ),
    );
  }

  const statusRule = resolveStatus(issue, input.policy.statuses);
  if (!statusRule) {
    blockers.push("status_unmapped");
    fieldResults.push(
      fieldResult("status", "Status", "status", "blocked", "status_unmapped"),
    );
  } else {
    fieldResults.push(
      fieldResult(
        "status",
        "Status",
        "status",
        "mapped",
        "configured_status_policy",
      ),
    );
  }
  if (statusRule?.status === "closed" && !statusRule.closedReason) {
    blockers.push("closed_reason_policy_missing");
    fieldResults.push(
      fieldResult(
        "status",
        "Status",
        "closed_reason",
        "blocked",
        "closed_reason_policy_missing",
      ),
    );
  }

  const issueType = resolveIssueType(issue, input.policy.issueTypes);
  if (!issueType) {
    blockers.push("issue_type_unmapped");
    fieldResults.push(
      fieldResult(
        "issuetype",
        "Issue type",
        "issue_type",
        "blocked",
        "issue_type_unmapped",
      ),
    );
  } else {
    fieldResults.push(
      fieldResult(
        "issuetype",
        "Issue type",
        "issue_type",
        "mapped",
        issue.issueTypeSubtask
          ? "subtask_to_task"
          : "configured_issue_type_policy",
      ),
    );
  }

  const priority = resolvePriority(issue, input.policy.priorities);
  if (issue.priority && !priority) {
    warnings.push("priority_unmapped");
    fieldResults.push(
      fieldResult(
        "priority",
        "Priority",
        "priority",
        "preserved",
        "priority_unmapped",
        "desired.issue.custom_fields.jira.enums.priority",
      ),
    );
  } else if (issue.priority) {
    fieldResults.push(
      fieldResult(
        "priority",
        "Priority",
        "priority",
        "mapped",
        "configured_priority_policy",
      ),
    );
  }

  const descriptionIsAdf =
    issue.description !== null && typeof issue.description === "object";
  if (descriptionIsAdf && !input.rawArchiveReferences.descriptionAdf) {
    blockers.push("raw_archive_reference_missing:description_adf");
  }
  const description = descriptionIsAdf
    ? convertAdfToMarkdown(issue.description, {
        accountMapping: safeAccountMapping,
        descriptionRawArchiveReference:
          input.rawArchiveReferences.descriptionAdf,
        mediaRawArchiveReferences: input.rawArchiveReferences.media,
      })
    : {
        markdown:
          typeof issue.description === "string" ? issue.description : "",
        reports: [],
        media: [],
      };
  for (const report of description.reports) {
    fieldResults.push(
      fieldResult(
        `description:${report.path}`,
        report.nodeType,
        "content",
        report.classification === "unsupported"
          ? "unsupported"
          : report.classification,
        report.reason,
        report.rawArchiveReference
          ? "raw_preservation.archiveReferences"
          : null,
      ),
    );
  }
  for (const media of description.media) {
    deferred.push({
      kind: "description_media",
      reason: "needs_media_rewrite",
      sourceKey: media.mediaId,
      targetId: null,
    });
    if (!media.rawArchiveReference) {
      blockers.push(`raw_archive_reference_missing:media:${media.mediaId}`);
    }
  }

  const actors = mapJiraIssueActors(parsedIssue, safeAccountMapping);
  const planActors = Object.fromEntries(
    Object.entries(actors).map(([context, actor]) => [
      context,
      actor.strategy === "fallback" ? null : actor.actor,
    ]),
  ) as Record<keyof typeof actors, string | null>;
  const safeUsers = Object.values(actors).map((actor) => ({
    context: actor.context,
    actor: actor.strategy === "fallback" ? null : actor.actor,
    strategy: actor.strategy,
  }));
  for (const actor of Object.values(actors)) {
    if (actor.strategy !== "fallback") continue;
    warnings.push(`actor_unmapped:${actor.context}`);
    fieldResults.push(
      fieldResult(
        actor.context,
        actor.context,
        actor.context,
        "preserved",
        "actor_unmapped",
        "raw_preservation.archiveReferences",
      ),
    );
  }

  let parentId: string | null = null;
  if (issue.parent) {
    parentId = input.targetIdsByJiraKey[issue.parent.key] ?? null;
    if (!parentId) {
      const sourceProject = issue.parent.key.split("-", 1)[0];
      deferred.push({
        kind: "parent",
        reason:
          sourceProject && sourceProject !== issue.projectKey
            ? "cross_project_reconcile"
            : "needs_parent_reconcile",
        sourceKey: issue.parent.key,
        targetId: null,
      });
    }
  }
  if (issue.issueTypeSubtask && !parentId) {
    blockers.push("subtask_parent_missing");
  }
  for (const relation of issue.links) {
    const targetId = input.targetIdsByJiraKey[relation.issueKey] ?? null;
    const sourceProject = relation.issueKey.split("-", 1)[0];
    deferred.push({
      kind: "relation",
      reason:
        sourceProject && sourceProject !== issue.projectKey
          ? "cross_project_reconcile"
          : "needs_relation_reconcile",
      sourceKey: relation.issueKey,
      targetId,
    });
    fieldResults.push(
      fieldResult(
        `issuelinks:${relation.id ?? relation.issueKey}`,
        relation.type ?? "Issue link",
        null,
        "deferred",
        "relation semantics require reconciliation",
        "deferred",
      ),
    );
  }

  const projectId = asString(parsedIssue.fields.project?.id);
  if (issue.fixVersions.length > 0 && !projectId) {
    blockers.push("version_project_id_missing");
    fieldResults.push(
      fieldResult(
        "fixVersions",
        "Fix versions",
        "release_id",
        "blocked",
        "version_project_id_missing",
        "raw_preservation.archiveReferences",
      ),
    );
  }
  if (issue.fixVersions.some((version) => !asString(version.id))) {
    blockers.push("version_id_missing");
    fieldResults.push(
      fieldResult(
        "fixVersions",
        "Fix versions",
        "release_id",
        "blocked",
        "version_id_missing",
        "raw_preservation.archiveReferences",
      ),
    );
  }
  const versionRelations = issue.fixVersions.flatMap((version) => {
    const sourceId = asString(version.id);
    if (!sourceId || !projectId) return [];
    return [
      {
        sourceKey: jiraVersionSourceIdentity(
          input.jiraCloudId,
          projectId,
          sourceId,
        ).key,
        sourceId,
        name: asString(version.name),
      },
    ];
  });

  const sprintField = fieldResolutions.sprint.field;
  const sprintRaw = sprintField
    ? parsedIssue.fields[sprintField.id]
    : undefined;
  const sprintValues = Array.isArray(sprintRaw)
    ? sprintRaw
    : sprintRaw !== null && sprintRaw !== undefined
      ? [sprintRaw]
      : [];
  const invalidSprintValues: unknown[] = [];
  const sprintRelations = sprintValues.flatMap((rawSprint) => {
    const parsed = JiraSprintSchema.safeParse(rawSprint);
    if (!parsed.success) {
      invalidSprintValues.push(rawSprint);
      return [];
    }
    return [
      {
        sourceKey: jiraSprintSourceIdentity(input.jiraCloudId, parsed.data.id)
          .key,
        sourceId: parsed.data.id,
        name: parsed.data.name,
      },
    ];
  });
  if (invalidSprintValues.length > 0 && sprintField) {
    blockers.push("sprint_value_unsupported");
    fieldResults.push(
      fieldResult(
        sprintField.id,
        sprintField.name,
        "sprint_id",
        "blocked",
        "sprint_value_unsupported",
        "raw_preservation.archiveReferences",
      ),
    );
  }

  const releaseAssociations = planAssociations(
    "version",
    versionRelations,
    input.planningMappings.releases,
    input.configuredPrimary?.releaseSourceKey,
    deferred,
  );
  const sprintAssociations = planAssociations(
    "sprint",
    sprintRelations,
    input.planningMappings.sprints,
    input.configuredPrimary?.sprintSourceKey,
    deferred,
  );
  const planningAssociations = [...releaseAssociations, ...sprintAssociations];
  const releaseId =
    releaseAssociations.find((association) => association.primary)?.targetId ??
    null;
  const sprintId =
    sprintAssociations.find((association) => association.primary)?.targetId ??
    null;

  const storyPointsField = fieldResolutions.story_points.field;
  const storyPointsValue = storyPointsField
    ? parsedIssue.fields[storyPointsField.id]
    : undefined;
  const estimatePoints =
    typeof storyPointsValue === "number" && storyPointsValue >= 0
      ? storyPointsValue
      : null;
  const startDateField = fieldResolutions.start_date.field;
  const startDateValue = startDateField
    ? parsedIssue.fields[startDateField.id]
    : undefined;
  const startDate = typeof startDateValue === "string" ? startDateValue : null;

  if (
    Object.values(fieldResolutions).some(
      (result) =>
        result.classification === "field_ambiguous" ||
        result.classification === "field_override_invalid",
    )
  ) {
    blockers.push("field_catalog_blocked");
  }

  const resolvedCatalogFieldIds = new Set(
    Object.values(fieldResolutions).flatMap((resolution) =>
      resolution.field ? [resolution.field.id] : [],
    ),
  );
  const unknownFields = Object.entries(parsedIssue.fields).filter(
    ([key, value]) =>
      !knownFieldKeys.has(key) &&
      !resolvedCatalogFieldIds.has(key) &&
      value !== null &&
      value !== undefined,
  );
  for (const [key] of unknownFields) {
    fieldResults.push(
      fieldResult(
        key,
        input.fieldCatalog.fields.find((field) => field.id === key)?.name ??
          key,
        null,
        "preserved",
        "raw_only_field",
        "raw_preservation.archiveReferences",
      ),
    );
  }

  const issueMatchedRankPlan =
    input.rankPlan?.jiraKey === issue.key &&
    input.rankPlan.reefId === input.targetReefId
      ? input.rankPlan
      : null;
  if (input.rankPlan && !issueMatchedRankPlan) {
    blockers.push("rank_plan_issue_mismatch");
  }
  const rankField = fieldResolutions.rank.field;
  const rawRankValue = rankField ? parsedIssue.fields[rankField.id] : undefined;
  const rankPlanMatchesCurrentValue =
    !issueMatchedRankPlan ||
    !rankField ||
    ((typeof rawRankValue === "string" ||
      rawRankValue === null ||
      rawRankValue === undefined) &&
      issueMatchedRankPlan.provenance.value === (rawRankValue ?? null));
  if (issueMatchedRankPlan && !rankPlanMatchesCurrentValue && rankField) {
    blockers.push("rank_plan_value_mismatch");
    fieldResults.push(
      fieldResult(
        rankField.id,
        rankField.name,
        "rank",
        "blocked",
        "rank_plan_value_mismatch",
        "raw_preservation.archiveReferences",
      ),
    );
  }
  const rankPlan = rankPlanMatchesCurrentValue ? issueMatchedRankPlan : null;
  if (rankPlan?.reportClassification === "rank_unmapped") {
    warnings.push(`rank_unmapped:${rankPlan.reportReason ?? "unknown"}`);
  }

  const jiraProvenance = {
    key: issue.key,
    id: issue.id,
    project_key: issue.projectKey,
    enums: {
      status: {
        id: issue.statusId,
        name: issue.status,
        category_key: issue.statusCategoryKey,
        category_name: issue.statusCategoryName,
      },
      issue_type: {
        id: issue.issueTypeId,
        name: issue.issueType,
        subtask: issue.issueTypeSubtask,
        hierarchy_level: issue.issueTypeHierarchyLevel,
      },
      priority: issue.priority,
      resolution: issue.resolution,
    },
    timestamps: { created: issue.created, updated: issue.updated },
    parent: issue.parent,
    planning: planningAssociations.map((association) => ({
      kind: association.kind,
      source_key: association.sourceKey,
      source_id: association.sourceId,
      primary: association.primary,
      target_id: association.targetId,
      selection_reason: association.selectionReason,
    })),
    users: safeUsers,
    fields: Object.fromEntries(
      Object.entries(fieldResolutions).map(([role, result]) => [
        role,
        {
          id: result.field?.id ?? null,
          classification: result.classification,
        },
      ]),
    ),
  };
  const customFields = mergeJiraCustomFields(
    undefined,
    jiraProvenance,
    rankPlan?.issueFields.custom_fields &&
      typeof rankPlan.issueFields.custom_fields.jira === "object"
      ? rankPlan.issueFields.custom_fields.jira
      : undefined,
  );

  let desiredIssue: IssueMetadata | null = null;
  if (blockers.length === 0 && statusRule && issueType) {
    const candidate: IssueMetadata = {
      id: input.targetReefId,
      title: issue.summary,
      status: StatusEnum.parse(statusRule.status),
      created_at: input.runAt,
      created_by: planActors.creator ?? input.migrationActor,
      updated_at: input.runAt,
      updated_by: input.migrationActor,
      issue_type: IssueTypeEnum.parse(issueType),
      priority: priority ? PriorityEnum.parse(priority) : null,
      assigned_to: planActors.assignee,
      requester: planActors.requester,
      reporter: planActors.reporter,
      start_date: startDate,
      due_date: issue.dueDate,
      milestone_id: null,
      sprint_id: sprintId,
      release_id: releaseId,
      estimate_points: estimatePoints,
      severity: null,
      ...(rankPlan?.issueFields.rank !== undefined
        ? { rank: rankPlan.issueFields.rank }
        : {}),
      closed_at: statusRule.status === "closed" ? issue.resolutionDate : null,
      closed_reason:
        statusRule.status === "closed"
          ? ClosedReasonEnum.parse(statusRule.closedReason)
          : null,
      parent_id: parentId,
      labels: [...issue.labels],
      depends_on: [],
      related_to: [],
      blocks: [],
      source: "jira-migration",
      custom_fields: customFields,
    };
    const validation = IssueMetadataSchema.safeParse(candidate);
    if (validation.success) {
      desiredIssue = validation.data;
    } else {
      blockers.push("desired_issue_validation_failed");
      fieldResults.push(
        fieldResult(
          "validation",
          "Desired Reef issue",
          null,
          "blocked",
          "desired_issue_validation_failed",
        ),
      );
    }
  }

  const archiveReferences: JiraIssueImportPlan["raw_preservation"]["archiveReferences"] =
    [];
  if (input.rawArchiveReferences.issue) {
    archiveReferences.push({
      kind: "issue",
      reference: input.rawArchiveReferences.issue,
    });
  }
  if (input.rawArchiveReferences.descriptionAdf) {
    archiveReferences.push({
      kind: "description_adf",
      reference: input.rawArchiveReferences.descriptionAdf,
    });
  }
  if (input.rawArchiveReferences.watcherList) {
    archiveReferences.push({
      kind: "watcher_list",
      reference: input.rawArchiveReferences.watcherList,
    });
  }
  for (const reference of Object.values(
    input.rawArchiveReferences.media ?? {},
  )) {
    archiveReferences.push({ kind: "media", reference });
  }

  const status =
    blockers.length > 0
      ? "blocked"
      : warnings.length > 0 ||
          deferred.length > 0 ||
          fieldResults.some((result) => result.classification === "unsupported")
        ? "ready_with_warnings"
        : "ready";
  return parseJiraIssueImportPlan({
    schema_version: 1,
    source: {
      jiraCloudId: input.jiraCloudId,
      projectId,
      projectKey: issue.projectKey ?? issue.key.split("-")[0] ?? "unknown",
      issueId: issue.id,
      issueKey: issue.key,
      issueUrl: safeUrl(parsedIssue.self),
      fieldCatalog: {
        retrievedAt: input.fieldCatalog.retrievedAt,
        source: input.fieldCatalog.source,
      },
    },
    desired: { issue: desiredIssue, content: description.markdown },
    deferred,
    planning_associations: planningAssociations,
    field_results: fieldResults,
    raw_preservation: {
      compactPaths: ["desired.issue.custom_fields.jira"],
      archiveReferences,
    },
    warnings: [...new Set([...warnings, ...blockers])],
    status,
  });
};

export const buildJiraIssueImportPlans = (
  inputs: readonly BuildJiraIssueImportPlanInput[],
): readonly JiraIssueImportPlan[] =>
  deepFreeze(inputs.map((input) => buildJiraIssueImportPlan(input)));
