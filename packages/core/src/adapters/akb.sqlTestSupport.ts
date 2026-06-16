import type { Template } from "../schemas/issues/template";
import {
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
} from "./akb";

export function makeSqlQueryResponse(
  items: Record<string, unknown>[],
  columns: string[],
): unknown {
  return {
    kind: "table_query",
    columns,
    items,
    total: items.length,
    vaults: ["reef-sample"],
  };
}

export function makeSqlMutationResponse(result: string): unknown {
  return {
    kind: "table_sql",
    result,
    vaults: ["reef-sample"],
  };
}

export function makeSqlRuntimeErrorResponse(table: string): {
  status: number;
  body: unknown;
} {
  return {
    status: 200,
    body: { error: `relation "${table}" does not exist` },
  };
}

export function makeListTablesResponse(names: string[]): unknown {
  return {
    kind: "table",
    vault: "reef-sample",
    items: names.map((name) => ({ name })),
  };
}

export const ALL_REEF_TABLES = [
  REEF_SETTINGS_TABLE,
  MONITORED_REPOS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_TEMPLATES_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
];

export const SPRINT_ROW_COLUMNS = [
  "id",
  "name",
  "status",
  "start_date",
  "end_date",
  "goal",
  "capacity_points",
  "meta",
];

export const MILESTONE_ROW_COLUMNS = [
  "id",
  "name",
  "status",
  "target_date",
  "description",
  "meta",
];

export const RELEASE_ROW_COLUMNS = [
  "id",
  "name",
  "status",
  "target_date",
  "released_at",
  "notes",
  "meta",
];

export const SAMPLE_TEMPLATE: Template = {
  name: "bug-report",
  label: "Bug Report",
  description: "Standard bug report template",
  title_prefix: "Bug: ",
  default_labels: ["bug"],
  body: "## Repro\n\n## Expected\n\n## Actual",
};

export const TEMPLATE_ROW_COLUMNS = [
  "id",
  "name",
  "label",
  "description",
  "title_prefix",
  "priority",
  "default_labels",
  "body",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

export function makeTemplateRow(
  template: Template = SAMPLE_TEMPLATE,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 1,
    name: template.name,
    label: template.label,
    description: template.description,
    title_prefix: template.title_prefix ?? null,
    priority: template.priority ?? null,
    default_labels: template.default_labels ?? [],
    body: template.body,
    meta: null,
    created_at: "2026-05-20T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z",
    created_by: "akb-principal",
    ...overrides,
  };
}
