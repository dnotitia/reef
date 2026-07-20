import { z } from "zod";
import { deepFreeze } from "./customFields.js";
import { JiraFieldCatalogSchema, type JiraFieldPayload } from "./payloads.js";

export const JIRA_CANONICAL_FIELD_ROLES = [
  "sprint",
  "story_points",
  "start_date",
  "rank",
] as const;

export type JiraCanonicalFieldRole =
  (typeof JIRA_CANONICAL_FIELD_ROLES)[number];

export interface JiraFieldCatalogSnapshot {
  fields: readonly JiraFieldPayload[];
  retrievedAt: string;
  source: "jira_field_api" | "issue_expansion";
}

export type JiraFieldResolutionClassification =
  | "resolved"
  | "field_unresolved"
  | "field_ambiguous"
  | "field_override_invalid";

export interface JiraFieldResolution {
  role: JiraCanonicalFieldRole;
  classification: JiraFieldResolutionClassification;
  field: JiraFieldPayload | null;
  candidateIds: readonly string[];
  reason: string;
  provenance: {
    retrievedAt: string;
    source: JiraFieldCatalogSnapshot["source"];
  };
}

export type JiraFieldOverrides = Partial<
  Record<JiraCanonicalFieldRole, string>
>;

const roleSpecs: Record<
  JiraCanonicalFieldRole,
  {
    aliases: readonly string[];
    customKeys: readonly string[];
    types: readonly string[];
    items?: readonly string[];
  }
> = {
  sprint: {
    aliases: ["sprint", "sprints"],
    customKeys: ["com.pyxis.greenhopper.jira:gh-sprint"],
    types: ["array"],
    items: ["json", "string"],
  },
  story_points: {
    aliases: ["story point estimate", "story points", "story point"],
    customKeys: [
      "com.atlassian.jira.plugin.system.customfieldtypes:float",
      "com.pyxis.greenhopper.jira:jsw-story-points",
    ],
    types: ["number"],
  },
  start_date: {
    aliases: ["start date", "startdate"],
    customKeys: [
      "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
      "com.atlassian.jira.plugin.system.customfieldtypes:datetime",
    ],
    types: ["date", "datetime", "string"],
  },
  rank: {
    aliases: ["rank"],
    customKeys: ["com.pyxis.greenhopper.jira:gh-lexo-rank"],
    types: ["string"],
  },
};

const normalizeAlias = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");

const JiraFieldCatalogTimestampSchema = z.string().datetime({ offset: true });

const fieldAliases = (field: JiraFieldPayload): string[] =>
  [field.name, ...(field.clauseNames ?? [])].map(normalizeAlias);

const matchesExpectedSchema = (
  role: JiraCanonicalFieldRole,
  field: JiraFieldPayload,
): boolean => {
  const spec = roleSpecs[role];
  if (!field.schema?.type || !spec.types.includes(field.schema.type)) {
    return false;
  }
  if (
    spec.items &&
    field.schema.items !== undefined &&
    !spec.items.includes(field.schema.items)
  ) {
    return false;
  }
  return true;
};

const exactAliasMatch = (
  role: JiraCanonicalFieldRole,
  field: JiraFieldPayload,
): boolean => {
  const aliases = new Set(roleSpecs[role].aliases.map(normalizeAlias));
  return fieldAliases(field).some((alias) => aliases.has(alias));
};

const resolution = (
  snapshot: JiraFieldCatalogSnapshot,
  role: JiraCanonicalFieldRole,
  classification: JiraFieldResolutionClassification,
  field: JiraFieldPayload | null,
  candidates: readonly JiraFieldPayload[],
  reason: string,
): JiraFieldResolution =>
  deepFreeze({
    role,
    classification,
    field,
    candidateIds: candidates.map((candidate) => candidate.id).sort(),
    reason,
    provenance: {
      retrievedAt: snapshot.retrievedAt,
      source: snapshot.source,
    },
  });

export const buildJiraFieldCatalog = (input: {
  fields: unknown;
  retrievedAt: string;
  source?: JiraFieldCatalogSnapshot["source"];
}): JiraFieldCatalogSnapshot => {
  if (!JiraFieldCatalogTimestampSchema.safeParse(input.retrievedAt).success) {
    throw new Error("invalid Jira field catalog retrieval timestamp");
  }
  return deepFreeze({
    fields: JiraFieldCatalogSchema.parse(input.fields),
    retrievedAt: input.retrievedAt,
    source: input.source ?? "jira_field_api",
  });
};

export const resolveJiraField = (
  snapshot: JiraFieldCatalogSnapshot,
  role: JiraCanonicalFieldRole,
  overrides: JiraFieldOverrides = {},
): JiraFieldResolution => {
  const overrideId = overrides[role];
  if (overrideId) {
    const field = snapshot.fields.find(
      (candidate) => candidate.id === overrideId,
    );
    if (!field || !matchesExpectedSchema(role, field)) {
      return resolution(
        snapshot,
        role,
        "field_override_invalid",
        null,
        field ? [field] : [],
        "configured field is absent or has an incompatible schema",
      );
    }
    return resolution(
      snapshot,
      role,
      "resolved",
      field,
      [field],
      "explicit_override",
    );
  }

  const spec = roleSpecs[role];
  const schemaCandidates = snapshot.fields.filter(
    (field) =>
      matchesExpectedSchema(role, field) &&
      field.schema?.custom !== undefined &&
      spec.customKeys.includes(field.schema.custom),
  );
  if (schemaCandidates.length === 1) {
    return resolution(
      snapshot,
      role,
      "resolved",
      schemaCandidates[0] ?? null,
      schemaCandidates,
      "exact_schema_custom_key",
    );
  }
  if (schemaCandidates.length > 1) {
    return resolution(
      snapshot,
      role,
      "field_ambiguous",
      null,
      schemaCandidates,
      "multiple exact schema candidates; configure an explicit field id",
    );
  }

  const aliasCandidates = snapshot.fields.filter(
    (field) =>
      matchesExpectedSchema(role, field) && exactAliasMatch(role, field),
  );
  if (aliasCandidates.length === 1) {
    return resolution(
      snapshot,
      role,
      "resolved",
      aliasCandidates[0] ?? null,
      aliasCandidates,
      "normalized_exact_alias",
    );
  }
  if (aliasCandidates.length > 1) {
    return resolution(
      snapshot,
      role,
      "field_ambiguous",
      null,
      aliasCandidates,
      "multiple exact candidates; configure an explicit field id",
    );
  }
  return resolution(
    snapshot,
    role,
    "field_unresolved",
    null,
    [],
    "no exact catalog candidate; verify Jira field permission and configuration",
  );
};

export const resolveJiraFields = (
  snapshot: JiraFieldCatalogSnapshot,
  overrides: JiraFieldOverrides = {},
): Readonly<Record<JiraCanonicalFieldRole, JiraFieldResolution>> =>
  deepFreeze(
    Object.fromEntries(
      JIRA_CANONICAL_FIELD_ROLES.map((role) => [
        role,
        resolveJiraField(snapshot, role, overrides),
      ]),
    ) as Record<JiraCanonicalFieldRole, JiraFieldResolution>,
  );

export const JiraFieldCatalogSnapshotSchema = z
  .object({
    fields: JiraFieldCatalogSchema,
    retrievedAt: z.string().datetime({ offset: true }),
    source: z.enum(["jira_field_api", "issue_expansion"]),
  })
  .strict();
