import type { AkbAdapter, ExternalRef, IssueMetadata } from "@reef/core";
import type { JiraRelationKind } from "../related/contracts.js";

export const quote = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

export const sql = async (
  adapter: AkbAdapter,
  vault: string,
  statement: string,
): Promise<Record<string, unknown>[]> => {
  const response = (await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
    {
      method: "POST",
      body: { sql: statement },
      resource: `Jira migration data in ${vault}`,
    },
  )) as {
    kind?: string;
    items?: Record<string, unknown>[];
  };
  return response.kind === "table_query" ? (response.items ?? []) : [];
};

export const parseMeta = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export interface MigrationSidecar {
  relations: Array<{
    idempotencyKey: string;
    sourceReefId: string;
    targetReefId: string;
    relation: JiraRelationKind;
    inverseRelation: JiraRelationKind;
    provenance: Record<string, unknown>;
    sourceCreatedByMigration?: boolean;
    targetCreatedByMigration?: boolean;
  }>;
  externalRefs: Array<{
    idempotencyKey: string;
    reefId: string;
    ref: ExternalRef;
    provenance: Record<string, unknown>;
    createdByMigration?: boolean;
  }>;
}

export const sidecarFor = (issue: IssueMetadata): MigrationSidecar => {
  const custom = parseMeta(issue.custom_fields);
  const migration = parseMeta(custom.jira_migration);
  return {
    relations: Array.isArray(migration.relations)
      ? (migration.relations as MigrationSidecar["relations"])
      : [],
    externalRefs: Array.isArray(migration.external_refs)
      ? (migration.external_refs as MigrationSidecar["externalRefs"])
      : [],
  };
};

export const customFieldsWithSidecar = (
  issue: IssueMetadata,
  sidecar: MigrationSidecar,
  preservedCustomFields?: Record<string, unknown>,
): Record<string, unknown> => {
  const customFields = parseMeta(issue.custom_fields);
  const preserved = parseMeta(preservedCustomFields);
  const preservedMigration = parseMeta(preserved.jira_migration);
  const previouslyManaged = Array.isArray(
    preservedMigration.managed_custom_field_keys,
  )
    ? preservedMigration.managed_custom_field_keys.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  const preservedWithoutStaleManaged = { ...preserved };
  for (const key of previouslyManaged) delete preservedWithoutStaleManaged[key];
  const managedCustomFieldKeys = Object.keys(customFields)
    .filter((key) => key !== "jira_migration")
    .sort();
  return {
    ...preservedWithoutStaleManaged,
    ...customFields,
    jira_migration: {
      ...preservedMigration,
      ...parseMeta(customFields.jira_migration),
      relations: sidecar.relations,
      external_refs: sidecar.externalRefs,
      ...(preservedCustomFields
        ? { managed_custom_field_keys: managedCustomFieldKeys }
        : {}),
    },
  };
};

export const addUnique = (
  values: readonly string[] | undefined,
  value: string,
) => [...new Set([...(values ?? []), value])].sort();

export const removeValue = (
  values: readonly string[] | undefined,
  value: string,
) => (values ?? []).filter((candidate) => candidate !== value).sort();

const relationshipKeys = new Set<keyof IssueMetadata>([
  "depends_on",
  "blocks",
  "related_to",
]);
const targetManagedIssueKeys = new Set<keyof IssueMetadata>([
  "created_at",
  "updated_at",
]);

export const issueProjectionKeys = (
  issue: IssueMetadata,
): Array<keyof IssueMetadata> =>
  (Object.keys(issue) as Array<keyof IssueMetadata>).filter(
    (key) => issue[key] !== undefined && !targetManagedIssueKeys.has(key),
  );

export const issueProjection = (
  issue: IssueMetadata,
  keys: readonly (keyof IssueMetadata)[],
) =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      relationshipKeys.has(key) && issue[key] === undefined
        ? []
        : (issue[key] ?? null),
    ]),
  );
