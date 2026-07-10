import { DevelopmentTargetError, SchemaValidationError } from "../../../errors";
import {
  type DevelopmentProfileCatalog,
  type DevelopmentTargetConfig,
  DevelopmentTargetConfigSchema,
  type DevelopmentTargetItem,
  resolveDevelopmentTargetEligibility,
} from "../../../schemas/ai/developmentTargets";
import { MonitoredRepoSchema } from "../../../schemas/workspace/config";
import {
  MONITORED_REPOS_TABLE,
  REEF_DEVELOPMENT_TARGETS_TABLE,
} from "../core/constants";
import type { AkbAdapter } from "../core/http";
import {
  quoteIntOrNull,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
} from "../core/sql";
import { ensureReefTables } from "../core/tables";
import { withSpan } from "../core/tracing";

export interface ListDevelopmentTargetsParams {
  adapter: AkbAdapter;
  vault: string;
  catalog: DevelopmentProfileCatalog;
}

export interface WriteDevelopmentTargetParams {
  adapter: AkbAdapter;
  vault: string;
  target: DevelopmentTargetConfig;
  catalog: DevelopmentProfileCatalog;
}

function numberFromRow(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function booleanFromRow(value: unknown): boolean {
  return value === true || value === "true" || value === "t" || value === 1;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseConfigRow(row: Record<string, unknown>): DevelopmentTargetConfig {
  return DevelopmentTargetConfigSchema.parse({
    github_id: numberFromRow(row.target_github_id),
    enabled: booleanFromRow(row.enabled),
    recipe_path: nullableText(row.recipe_path),
    runner_profile: nullableText(row.runner_profile),
    permission_profile: nullableText(row.permission_profile),
    branch_template: nullableText(row.branch_template),
  });
}

export async function listDevelopmentTargets(
  params: ListDevelopmentTargetsParams,
): Promise<DevelopmentTargetItem[]> {
  const { adapter, vault, catalog } = params;
  return withSpan("akb.list_development_targets", { vault }, async (span) => {
    await ensureReefTables({ adapter, vault });
    const response = await runSql(
      adapter,
      vault,
      `SELECT m.github_id, m.owner, m.name, m.description, t.github_id AS target_github_id, t.enabled, t.recipe_path, t.runner_profile, t.permission_profile, t.branch_template FROM ${tableRef(
        MONITORED_REPOS_TABLE,
      )} m LEFT JOIN ${tableRef(
        REEF_DEVELOPMENT_TARGETS_TABLE,
      )} t ON t.github_id = m.github_id ORDER BY m.owner, m.name`,
    );
    const rows = response.kind === "table_query" ? response.items : [];
    const grouped = new Map<number, Record<string, unknown>[]>();
    for (const row of rows) {
      const githubId = numberFromRow(row.github_id);
      const current = grouped.get(githubId) ?? [];
      current.push(row);
      grouped.set(githubId, current);
    }

    const items: DevelopmentTargetItem[] = [];
    for (const rowsForRepo of grouped.values()) {
      const first = rowsForRepo[0];
      if (!first) continue;
      const repo = MonitoredRepoSchema.parse({
        github_id: numberFromRow(first.github_id),
        owner: first.owner,
        name: first.name,
        description: first.description ?? undefined,
      });
      const targetRows = rowsForRepo.filter(
        (row) => row.target_github_id != null,
      );
      const duplicate = targetRows.length > 1;
      let config: DevelopmentTargetConfig | null = null;
      let invalid = false;
      if (targetRows.length === 1) {
        const parsed = DevelopmentTargetConfigSchema.safeParse(
          (() => {
            try {
              return parseConfigRow(targetRows[0] as Record<string, unknown>);
            } catch {
              return null;
            }
          })(),
        );
        if (parsed.success) config = parsed.data;
        else invalid = true;
      }
      items.push({
        repo,
        config,
        eligibility: resolveDevelopmentTargetEligibility({
          config,
          catalog,
          duplicate: duplicate || invalid,
        }),
      });
    }
    span.setAttribute("target_count", items.length);
    span.setAttribute(
      "eligible_count",
      items.filter((item) => item.eligibility.eligible).length,
    );
    return items;
  });
}

export async function writeDevelopmentTarget(
  params: WriteDevelopmentTargetParams,
): Promise<DevelopmentTargetConfig> {
  const { adapter, vault, catalog } = params;
  const target = DevelopmentTargetConfigSchema.parse(params.target);
  return withSpan(
    "akb.write_development_target",
    { vault, github_id: target.github_id, enabled: target.enabled },
    async () => {
      await ensureReefTables({ adapter, vault });
      const monitored = await runSql(
        adapter,
        vault,
        `SELECT github_id FROM ${tableRef(
          MONITORED_REPOS_TABLE,
        )} WHERE github_id = ${quoteIntOrNull(target.github_id)} LIMIT 1`,
      );
      if (monitored.kind !== "table_query" || monitored.items.length === 0) {
        throw new DevelopmentTargetError("unmonitored");
      }

      if (target.enabled) {
        const runnerIds = new Set(
          catalog.runner_profiles.map((item) => item.id),
        );
        const permissionIds = new Set(
          catalog.permission_profiles.map((item) => item.id),
        );
        if (
          target.runner_profile == null ||
          target.permission_profile == null ||
          !runnerIds.has(target.runner_profile) ||
          !permissionIds.has(target.permission_profile)
        ) {
          throw new DevelopmentTargetError("profile_unavailable");
        }
      }

      const existing = await runSql(
        adapter,
        vault,
        `SELECT id FROM ${tableRef(
          REEF_DEVELOPMENT_TARGETS_TABLE,
        )} WHERE github_id = ${quoteIntOrNull(target.github_id)}`,
      );
      const existingIds =
        existing.kind === "table_query"
          ? existing.items
              .map((row) => row.id)
              .filter(
                (id): id is string => typeof id === "string" && id.length > 0,
              )
          : [];
      if (
        existing.kind !== "table_query" ||
        existingIds.length !== existing.items.length
      ) {
        throw new SchemaValidationError({
          issues: ["development target rows must expose stable ids"],
        });
      }

      const assignments = `enabled = ${target.enabled ? "TRUE" : "FALSE"}, recipe_path = ${quoteTextOrNull(
        target.recipe_path,
        "development target recipe_path",
      )}, runner_profile = ${quoteTextOrNull(
        target.runner_profile,
        "development target runner_profile",
      )}, permission_profile = ${quoteTextOrNull(
        target.permission_profile,
        "development target permission_profile",
      )}, branch_template = ${quoteTextOrNull(
        target.branch_template,
        "development target branch_template",
      )}`;

      const retainedId = existingIds[0];
      if (retainedId) {
        await runSql(
          adapter,
          vault,
          `UPDATE ${tableRef(
            REEF_DEVELOPMENT_TARGETS_TABLE,
          )} SET ${assignments} WHERE id = ${quoteText(retainedId, "development target id")}`,
        );
      } else {
        await runSql(
          adapter,
          vault,
          `INSERT INTO ${tableRef(
            REEF_DEVELOPMENT_TARGETS_TABLE,
          )} (github_id, enabled, recipe_path, runner_profile, permission_profile, branch_template) VALUES (${quoteIntOrNull(
            target.github_id,
          )}, ${target.enabled ? "TRUE" : "FALSE"}, ${quoteTextOrNull(
            target.recipe_path,
            "development target recipe_path",
          )}, ${quoteTextOrNull(
            target.runner_profile,
            "development target runner_profile",
          )}, ${quoteTextOrNull(
            target.permission_profile,
            "development target permission_profile",
          )}, ${quoteTextOrNull(
            target.branch_template,
            "development target branch_template",
          )})`,
        );
      }

      if (existingIds.length > 1 && retainedId) {
        await runSql(
          adapter,
          vault,
          `DELETE FROM ${tableRef(
            REEF_DEVELOPMENT_TARGETS_TABLE,
          )} WHERE github_id = ${quoteIntOrNull(target.github_id)} AND id <> ${quoteText(
            retainedId,
            "development target id",
          )}`,
        );
      }
      return target;
    },
  );
}
