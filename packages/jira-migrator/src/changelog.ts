import type {
  ActivityEventInput,
  ExternalRef,
  IssueType,
  RelationField,
  Status,
} from "@reef/core";
import { z } from "zod";
import { deepFreeze } from "./customFields.js";
import {
  type JiraFieldCatalogSnapshot,
  type JiraFieldOverrides,
  resolveJiraField,
} from "./fieldCatalog.js";
import { RawArchiveReferenceSchema } from "./importPlan.js";
import { jiraChangelogSourceIdentity } from "./ledger.js";
import {
  type JiraChangelogHistoryPayload,
  JiraChangelogHistorySchema,
  type JiraChangelogItemPayload,
} from "./payloads.js";
import { type RawArchiveReference, sha256CanonicalJson } from "./rawArchive.js";

export const JiraChangelogClassificationSchema = z.enum([
  "promoted",
  "raw",
  "deferred",
  "failed",
]);
export type JiraChangelogClassification = z.infer<
  typeof JiraChangelogClassificationSchema
>;

export const JIRA_CHANGELOG_FIELD_ROLES = [
  "status",
  "assignee",
  "summary",
  "parent",
  "due_date",
  "labels",
  "issue_type",
  "start_date",
  "fix_version",
  "issue_link",
  "remote_link",
  "attachment",
  "description",
  "rank",
  "goals",
  "resolution",
  "comment",
] as const;
export type JiraChangelogFieldRole =
  (typeof JIRA_CHANGELOG_FIELD_ROLES)[number];

export interface JiraAttachmentActivityBinding {
  attachment_id: string;
  file_uri: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface JiraRelationActivityBinding {
  linkType: string;
  direction: "inward" | "outward";
  targetIssueId: string;
  relation: RelationField;
}

export interface JiraCurrentIssueLinkSnapshot {
  id: string;
  type: string;
  direction: "inward" | "outward";
  targetIssueId: string;
}

export interface JiraCurrentRemoteLinkSnapshot {
  id: string;
  globalId: string;
  url: string;
  title: string;
  application: string | null;
  relationship: string | null;
}

export interface BuildJiraChangelogPlanInput {
  jiraCloudId: string;
  issueId: string;
  reefId: string;
  history: JiraChangelogHistoryPayload | unknown;
  rawArchiveReference?: RawArchiveReference;
  fieldCatalog: JiraFieldCatalogSnapshot;
  fieldOverrides?: JiraFieldOverrides;
  configuredExactAliases?: Readonly<Record<string, JiraChangelogFieldRole>>;
  actorBindings: Readonly<Record<string, string>>;
  statusMappings?: Readonly<Record<string, Status>>;
  issueTypeMappings?: Readonly<Record<string, IssueType>>;
  issueBindings?: Readonly<Record<string, string>>;
  releaseBindings?: Readonly<Record<string, string>>;
  attachmentBindings?: Readonly<Record<string, JiraAttachmentActivityBinding>>;
  relationBindings?: Readonly<Record<string, JiraRelationActivityBinding>>;
  currentIssueLinks?: readonly JiraCurrentIssueLinkSnapshot[];
  currentRemoteLinks?: readonly JiraCurrentRemoteLinkSnapshot[];
  boundSourceFingerprint?: string;
}

export interface JiraChangelogItemPlan {
  itemIndex: number;
  fieldId: string | null;
  classification: JiraChangelogClassification;
  reason: string;
  rawArchiveReference: RawArchiveReference;
  activity: ActivityEventInput | null;
  externalRef: ExternalRef | null;
}

export interface JiraChangelogReportCounts {
  promoted: number;
  raw: number;
  deferred: number;
  failed: number;
}

export interface JiraChangelogPlan {
  schema_version: 1;
  sourceIdentity: ReturnType<typeof jiraChangelogSourceIdentity>;
  sourceFingerprint: string;
  rawArchiveReference: RawArchiveReference;
  items: readonly JiraChangelogItemPlan[];
  report: {
    historyCount: 1;
    itemCount: number;
    totals: JiraChangelogReportCounts;
    byField: Readonly<Record<string, JiraChangelogReportCounts>>;
    rawPreservationLocations: readonly RawArchiveReference[];
  };
}

const BUILT_IN_ROLE_BY_FIELD_ID: Readonly<
  Record<string, JiraChangelogFieldRole>
> = {
  status: "status",
  assignee: "assignee",
  summary: "summary",
  parent: "parent",
  duedate: "due_date",
  labels: "labels",
  issuetype: "issue_type",
  fixVersions: "fix_version",
  issuelinks: "issue_link",
  RemoteIssueLink: "remote_link",
  RemoteWorkItemLink: "remote_link",
  attachment: "attachment",
  description: "description",
  resolution: "resolution",
  Comment: "comment",
  Goals: "goals",
} as const;

const RAW_ONLY_ROLES = new Set<JiraChangelogFieldRole>([
  "description",
  "rank",
  "goals",
  "resolution",
  "comment",
]);

const emptyCounts = (): JiraChangelogReportCounts => ({
  promoted: 0,
  raw: 0,
  deferred: 0,
  failed: 0,
});

const nullableValue = (
  item: JiraChangelogItemPayload,
  side: "from" | "to",
): string | null => item[side] ?? item[`${side}String`] ?? null;

const mappedValue = <T>(
  item: JiraChangelogItemPayload,
  side: "from" | "to",
  mappings: Readonly<Record<string, T>>,
): T | null | undefined => {
  const raw = nullableValue(item, side);
  return raw === null ? null : mappings[raw];
};

const isoOrNull = (value: string | null): string | null | undefined => {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
};

const stringSet = (value: string | null): string[] =>
  value === null || value.trim() === ""
    ? []
    : [...new Set(value.split(",").map((part) => part.trim()))]
        .filter(Boolean)
        .sort();

const setDiff = (from: string[], to: string[]) => {
  const fromSet = new Set(from);
  const toSet = new Set(to);
  return {
    added: to.filter((value) => !fromSet.has(value)),
    removed: from.filter((value) => !toSet.has(value)),
  };
};

const encoded = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const jiraChangelogActivityEventKey = (input: {
  cloudId: string;
  issueId: string;
  historyId: string;
  itemIndex: number;
  eventType: string;
}): string =>
  `jira-changelog:${encoded(input.cloudId)}:${encoded(input.issueId)}:${encoded(
    input.historyId,
  )}:${input.itemIndex}:${input.eventType}`;

const resolveRole = (
  item: JiraChangelogItemPayload,
  input: BuildJiraChangelogPlanInput,
): JiraChangelogFieldRole | null => {
  if (item.fieldId) {
    const builtIn = BUILT_IN_ROLE_BY_FIELD_ID[item.fieldId];
    if (builtIn) return builtIn;
    for (const role of ["start_date", "rank"] as const) {
      const resolution = resolveJiraField(
        input.fieldCatalog,
        role,
        input.fieldOverrides,
      );
      if (
        resolution.classification === "resolved" &&
        resolution.field?.id === item.fieldId
      ) {
        return role;
      }
    }
  }
  return input.configuredExactAliases?.[item.field] ?? null;
};

const safeSource = (sourceKey: string, itemIndex: number): string =>
  `jira-changelog:${sourceKey}:${itemIndex}`;

const planItem = (
  input: BuildJiraChangelogPlanInput,
  history: JiraChangelogHistoryPayload,
  rawArchiveReference: RawArchiveReference,
  item: JiraChangelogItemPayload,
  itemIndex: number,
): JiraChangelogItemPlan => {
  const base = {
    itemIndex,
    fieldId: item.fieldId ?? null,
    rawArchiveReference,
    activity: null,
    externalRef: null,
  } satisfies Omit<JiraChangelogItemPlan, "classification" | "reason">;
  const role = resolveRole(item, input);
  if (!role) {
    return { ...base, classification: "raw", reason: "unmapped_field_raw" };
  }
  if (RAW_ONLY_ROLES.has(role)) {
    return { ...base, classification: "raw", reason: `${role}_raw_only` };
  }

  const activityAt = history.created;
  if (!activityAt || !Number.isFinite(Date.parse(activityAt))) {
    return {
      ...base,
      classification: "deferred",
      reason: "history_created_invalid",
    };
  }

  const accountId = history.author?.accountId;
  const actor = accountId ? input.actorBindings[accountId] : undefined;
  if (!actor) {
    return {
      ...base,
      classification: "deferred",
      reason: "actor_binding_missing",
    };
  }

  const event = <T extends ActivityEventInput>(
    value: Omit<T, "reefId" | "at" | "actor" | "source" | "eventKey">,
  ): ActivityEventInput => {
    const eventType = value.eventType;
    return {
      ...value,
      reefId: input.reefId,
      at: activityAt,
      actor,
      source: safeSource(
        jiraChangelogSourceIdentity(
          input.jiraCloudId,
          input.issueId,
          history.id,
        ).key,
        itemIndex,
      ),
      eventKey: jiraChangelogActivityEventKey({
        cloudId: input.jiraCloudId,
        issueId: input.issueId,
        historyId: history.id,
        itemIndex,
        eventType,
      }),
    } as ActivityEventInput;
  };
  const promoted = (activity: ActivityEventInput): JiraChangelogItemPlan => ({
    ...base,
    classification: "promoted",
    reason: "lossless_activity_mapping",
    activity,
  });
  const deferred = (reason: string): JiraChangelogItemPlan => ({
    ...base,
    classification: "deferred",
    reason,
  });

  switch (role) {
    case "status": {
      const from = mappedValue(item, "from", input.statusMappings ?? {});
      const to = mappedValue(item, "to", input.statusMappings ?? {});
      return from && to
        ? promoted(event({ eventType: "status_change", payload: { from, to } }))
        : deferred("status_mapping_missing");
    }
    case "assignee": {
      const from = mappedValue(item, "from", input.actorBindings);
      const to = mappedValue(item, "to", input.actorBindings);
      return from !== undefined && to !== undefined
        ? promoted(
            event({ eventType: "assignee_change", payload: { from, to } }),
          )
        : deferred("assignee_binding_missing");
    }
    case "summary": {
      const from = item.fromString;
      const to = item.toString;
      return typeof from === "string" && typeof to === "string"
        ? promoted(event({ eventType: "title_change", payload: { from, to } }))
        : deferred("title_value_missing");
    }
    case "parent": {
      const from = mappedValue(item, "from", input.issueBindings ?? {});
      const to = mappedValue(item, "to", input.issueBindings ?? {});
      return from !== undefined && to !== undefined
        ? promoted(event({ eventType: "parent_change", payload: { from, to } }))
        : deferred("parent_binding_missing");
    }
    case "due_date": {
      const from = isoOrNull(nullableValue(item, "from"));
      const to = isoOrNull(nullableValue(item, "to"));
      return from !== undefined && to !== undefined
        ? promoted(
            event({ eventType: "due_date_change", payload: { from, to } }),
          )
        : deferred("due_date_lossy");
    }
    case "labels": {
      const payload = setDiff(
        stringSet(nullableValue(item, "from")),
        stringSet(nullableValue(item, "to")),
      );
      return promoted(event({ eventType: "labels_change", payload }));
    }
    case "issue_type": {
      const from = mappedValue(item, "from", input.issueTypeMappings ?? {});
      const to = mappedValue(item, "to", input.issueTypeMappings ?? {});
      return from && to
        ? promoted(
            event({ eventType: "issue_type_change", payload: { from, to } }),
          )
        : deferred("issue_type_mapping_lossy");
    }
    case "start_date": {
      const from = isoOrNull(nullableValue(item, "from"));
      const to = isoOrNull(nullableValue(item, "to"));
      return from !== undefined && to !== undefined
        ? promoted(
            event({ eventType: "start_date_change", payload: { from, to } }),
          )
        : deferred("start_date_lossy");
    }
    case "fix_version": {
      const from = mappedValue(item, "from", input.releaseBindings ?? {});
      const to = mappedValue(item, "to", input.releaseBindings ?? {});
      return from !== undefined && to !== undefined
        ? promoted(
            event({
              eventType: "planning_link",
              payload: { field: "release", from, to },
            }),
          )
        : deferred("release_binding_missing");
    }
    case "issue_link": {
      const linkId = nullableValue(item, item.to == null ? "from" : "to");
      const binding = linkId ? input.relationBindings?.[linkId] : undefined;
      const snapshot = linkId
        ? input.currentIssueLinks?.find(
            (candidate) =>
              candidate.id === linkId &&
              candidate.type === binding?.linkType &&
              candidate.direction === binding.direction &&
              candidate.targetIssueId === binding.targetIssueId,
          )
        : undefined;
      const target = binding
        ? input.issueBindings?.[binding.targetIssueId]
        : undefined;
      if (!binding || !snapshot || !target) {
        return deferred("issue_link_reconciliation_missing");
      }
      const adding = item.to != null;
      return promoted(
        event({
          eventType: "relation_change",
          payload: {
            relation: binding.relation,
            added: adding ? [target] : [],
            removed: adding ? [] : [target],
          },
        }),
      );
    }
    case "remote_link": {
      const remoteId = nullableValue(item, item.to == null ? "from" : "to");
      const snapshot = remoteId
        ? input.currentRemoteLinks?.find(
            (candidate) => candidate.id === remoteId,
          )
        : undefined;
      if (!snapshot) return deferred("remote_link_snapshot_missing");
      const isConfluence =
        snapshot.application === "Confluence" ||
        snapshot.globalId.toLocaleLowerCase("en-US").includes("confluence");
      return {
        ...base,
        classification: "promoted",
        reason: "current_remote_link_external_ref",
        externalRef: {
          type: isConfluence ? "confluence" : "url",
          ref: snapshot.globalId,
          url: snapshot.url,
          label: snapshot.title,
        },
      };
    }
    case "attachment": {
      const attachmentId = nullableValue(item, item.to == null ? "from" : "to");
      const binding = attachmentId
        ? input.attachmentBindings?.[attachmentId]
        : undefined;
      if (!binding) return deferred("attachment_identity_missing");
      return promoted(
        event({
          eventType:
            item.to == null ? "attachment_removed" : "attachment_added",
          payload: binding,
        }),
      );
    }
    case "description":
    case "rank":
    case "goals":
    case "resolution":
    case "comment":
      return { ...base, classification: "raw", reason: `${role}_raw_only` };
  }
};

const buildReport = (
  items: readonly JiraChangelogItemPlan[],
  rawArchiveReference: RawArchiveReference,
): JiraChangelogPlan["report"] => {
  const totals = emptyCounts();
  const byField: Record<string, JiraChangelogReportCounts> = {};
  for (const item of items) {
    totals[item.classification] += 1;
    const field = item.fieldId ?? "unidentified";
    const counts = byField[field] ?? emptyCounts();
    counts[item.classification] += 1;
    byField[field] = counts;
  }
  return {
    historyCount: 1,
    itemCount: items.length,
    totals,
    byField,
    rawPreservationLocations: [rawArchiveReference],
  };
};

export const buildJiraChangelogPlan = (
  input: BuildJiraChangelogPlanInput,
): JiraChangelogPlan => {
  if (!input.rawArchiveReference) {
    throw new Error("raw archive reference is required");
  }
  const rawArchiveReference = RawArchiveReferenceSchema.parse(
    input.rawArchiveReference,
  );
  // Raw archival precedes schema normalization. Fingerprint the exact Jira
  // payload so number-to-string coercions and omitted/null distinctions cannot
  // make a verified archive reference appear to point at different bytes.
  const sourceFingerprint = sha256CanonicalJson(input.history);
  if (rawArchiveReference.contentSha256 !== sourceFingerprint) {
    throw new Error("raw archive checksum does not match changelog history");
  }
  const history = JiraChangelogHistorySchema.parse(input.history);
  const sourceIdentity = jiraChangelogSourceIdentity(
    input.jiraCloudId,
    input.issueId,
    history.id,
  );
  const drifted =
    input.boundSourceFingerprint !== undefined &&
    input.boundSourceFingerprint !== sourceFingerprint;
  const items = drifted
    ? history.items.map(
        (item, itemIndex): JiraChangelogItemPlan => ({
          itemIndex,
          fieldId: item.fieldId ?? null,
          classification: "failed",
          reason: "source_fingerprint_conflict",
          rawArchiveReference,
          activity: null,
          externalRef: null,
        }),
      )
    : history.items.map((item, itemIndex) =>
        planItem(input, history, rawArchiveReference, item, itemIndex),
      );
  return deepFreeze({
    schema_version: 1,
    sourceIdentity,
    sourceFingerprint,
    rawArchiveReference,
    items,
    report: buildReport(items, rawArchiveReference),
  });
};
