import {
  IssueListItemSchema,
  MyWorkQuerySchema,
  VaultNameSchema,
  type MyWorkIssue,
  type MyWorkQuery,
  type MyWorkWorkspace,
} from "../../../schemas";
import { SchemaValidationError } from "../../../errors";
import {
  type AkbAdapter,
  REEF_ISSUES_TABLE,
  SqlParameterBuilder,
  crossVaultTableRef,
  rowToIssue,
  runSql,
  withSpan,
} from "../core/shared";

export interface ListMyWorkIssuesParams {
  adapter: AkbAdapter;
  actor: string;
  vaults: readonly string[];
  query?: MyWorkQuery;
}

export interface ListMyWorkIssuesResult {
  issues: MyWorkIssue[];
  workspaces: MyWorkWorkspace[];
  next_offset: number | null;
  as_of: string;
}

const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const;

function compareWorkspaceNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeVaults(vaults: readonly string[]): string[] {
  const sorted = vaults
    .map((vault) => {
      const parsed = VaultNameSchema.safeParse(vault);
      if (!parsed.success) {
        throw new SchemaValidationError({ issues: ["invalid vault name"] });
      }
      return parsed.data;
    })
    .sort();
  const aliases = new Set<string>();
  for (const vault of sorted) {
    const alias = vault.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (aliases.has(alias)) {
      throw new SchemaValidationError({
        issues: ["vault names collide in the cross-vault SQL alias"],
      });
    }
    aliases.add(alias);
  }
  if (new Set(sorted).size !== sorted.length) {
    throw new SchemaValidationError({ issues: ["vault names must be unique"] });
  }
  return sorted;
}

function issueTableBranches(
  vaults: readonly string[],
  params: SqlParameterBuilder,
  actorParameter: string,
): string[] {
  const statuses = OPEN_STATUSES.map((status) =>
    params.add(status, "My Work status"),
  );
  return vaults.map((workspace) => {
    const workspaceParameter = params.add(workspace, "My Work workspace");
    const table = crossVaultTableRef(workspace, REEF_ISSUES_TABLE);
    return `SELECT issue_rows.*, ${workspaceParameter} AS workspace FROM ${table} AS issue_rows WHERE lower(btrim(issue_rows."assigned_to")) = lower(btrim(${actorParameter})) AND issue_rows."status" IN (${statuses.join(", ")}) AND issue_rows."archived_at" IS NULL`;
  });
}

function buildIssueQuery(
  vaults: readonly string[],
  actor: string,
  asOf: string,
  query: MyWorkQuery,
): { sql: string; params: readonly unknown[] } {
  const params = new SqlParameterBuilder();
  const actorParameter = params.add(actor, "My Work actor");
  const nowParameter = params.add(asOf, "My Work as-of time");
  const branches = issueTableBranches(vaults, params, actorParameter);
  const limitParameter =
    query.limit == null
      ? undefined
      : params.add(query.limit + 1, "My Work SQL limit");
  const offsetParameter =
    query.offset > 0
      ? params.add(query.offset, "My Work SQL offset")
      : undefined;
  const dueTimestamp = `(issue_rows."due_date"::timestamp AT TIME ZONE 'UTC')`;
  const asOfTimestamp = `(${nowParameter}::timestamptz AT TIME ZONE 'UTC')`;
  const sql = `SELECT * FROM (${branches.join(" UNION ALL ")}) AS issue_rows ORDER BY CASE WHEN "due_date" IS NOT NULL AND ${dueTimestamp} < ${asOfTimestamp} THEN 0 WHEN "due_date" IS NOT NULL AND ${dueTimestamp} <= ${asOfTimestamp} + INTERVAL '7 days' THEN 1 ELSE 2 END ASC, CASE WHEN "due_date" IS NOT NULL AND ${dueTimestamp} <= ${asOfTimestamp} + INTERVAL '7 days' THEN "due_date" END ASC NULLS LAST, CASE "priority" WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, CASE "status" WHEN 'in_progress' THEN 0 WHEN 'in_review' THEN 1 WHEN 'todo' THEN 2 WHEN 'backlog' THEN 3 ELSE 4 END ASC, "updated_at" DESC NULLS LAST, "workspace" ASC, "reef_id" ASC${limitParameter ? ` LIMIT ${limitParameter}` : ""}${offsetParameter ? ` OFFSET ${offsetParameter}` : ""}`;
  return { sql, params: params.params };
}

function buildWorkspaceCountQuery(
  vaults: readonly string[],
  actor: string,
): { sql: string; params: readonly unknown[] } {
  const params = new SqlParameterBuilder();
  const actorParameter = params.add(actor, "My Work actor");
  const branches = vaults.map((workspace) => {
    const workspaceParameter = params.add(workspace, "My Work workspace");
    const table = crossVaultTableRef(workspace, REEF_ISSUES_TABLE);
    return `SELECT ${workspaceParameter} AS workspace, "sprint_id", COUNT(*) AS assigned_count, COUNT(*) FILTER (WHERE "status" IN ('done', 'closed')) AS resolved_count FROM ${table} WHERE lower(btrim("assigned_to")) = lower(btrim(${actorParameter})) AND "archived_at" IS NULL GROUP BY "sprint_id"`;
  });
  return {
    sql: `SELECT * FROM (${branches.join(" UNION ALL ")}) AS workspace_counts ORDER BY "workspace" ASC, "sprint_id" ASC`,
    params: params.params,
  };
}

function rowsFrom(response: Awaited<ReturnType<typeof runSql>>) {
  return response.kind === "table_query" ? response.items : [];
}

/**
 * Read the signed-in actor's open work through one globally ordered cross-vault
 * SQL query. A separate cross-vault aggregate carries empty/caught-up and sprint
 * summary counts; done and closed issues never enter the My Work issue result.
 */
export async function listMyWorkIssues(
  input: ListMyWorkIssuesParams,
): Promise<ListMyWorkIssuesResult> {
  const query = MyWorkQuerySchema.parse(input.query ?? {});
  const actor = input.actor.trim();
  if (!actor) {
    throw new SchemaValidationError({ issues: ["My Work actor is required"] });
  }
  const vaults = normalizeVaults(input.vaults);
  const asOf = new Date().toISOString();

  return withSpan(
    "akb.list_my_work_issues",
    { workspace_count: vaults.length },
    async (span) => {
      if (vaults.length === 0) {
        span.setAttribute("issue_count", 0);
        return {
          issues: [],
          workspaces: [],
          next_offset: null,
          as_of: asOf,
        };
      }

      const primaryVault = vaults[0];
      if (!primaryVault) throw new Error("My Work has no primary workspace");
      const issueQuery = buildIssueQuery(vaults, actor, asOf, query);
      const countQuery = buildWorkspaceCountQuery(vaults, actor);
      const [issueResponse, countResponse] = await Promise.all([
        runSql(
          input.adapter,
          primaryVault,
          issueQuery.sql,
          issueQuery.params,
          vaults,
        ),
        runSql(
          input.adapter,
          primaryVault,
          countQuery.sql,
          countQuery.params,
          vaults,
        ),
      ]);

      const rawRows = rowsFrom(issueResponse);
      let nextOffset: number | null = null;
      let pageRows = rawRows;
      if (query.limit != null && rawRows.length > query.limit) {
        nextOffset = query.offset + query.limit;
        pageRows = rawRows.slice(0, query.limit);
      }

      const issues: MyWorkIssue[] = [];
      for (const row of pageRows) {
        try {
          const workspace = VaultNameSchema.parse(row.workspace);
          if (!vaults.includes(workspace)) continue;
          issues.push({
            workspace,
            issue: IssueListItemSchema.parse(rowToIssue(row)),
          });
        } catch {
          span.addEvent("my_work_issue_row_skipped", {
            reason: "invalid_issue_row",
          });
        }
      }

      const workspaceCounts = new Map(
        vaults.map((workspace) => [
          workspace,
          {
            workspace,
            assigned_issue_count: 0,
            resolved_sprint_counts:
              [] as MyWorkWorkspace["resolved_sprint_counts"],
          },
        ]),
      );
      for (const row of rowsFrom(countResponse)) {
        const workspace = VaultNameSchema.safeParse(row.workspace);
        const sprintId =
          typeof row.sprint_id === "string" ? row.sprint_id : null;
        const assignedCount =
          typeof row.assigned_count === "number"
            ? row.assigned_count
            : Number(row.assigned_count);
        const resolvedCount =
          typeof row.resolved_count === "number"
            ? row.resolved_count
            : Number(row.resolved_count);
        if (
          !workspace.success ||
          !vaults.includes(workspace.data) ||
          !Number.isSafeInteger(assignedCount) ||
          assignedCount < 0 ||
          !Number.isSafeInteger(resolvedCount) ||
          resolvedCount < 0
        ) {
          continue;
        }
        const counts = workspaceCounts.get(workspace.data);
        if (!counts) continue;
        counts.assigned_issue_count += assignedCount;
        if (sprintId && resolvedCount > 0) {
          counts.resolved_sprint_counts.push({
            sprint_id: sprintId,
            count: resolvedCount,
          });
        }
      }
      const workspaces = [...workspaceCounts.values()].map((workspace) => ({
        ...workspace,
        resolved_sprint_counts: workspace.resolved_sprint_counts.sort((a, b) =>
          compareWorkspaceNames(a.sprint_id, b.sprint_id),
        ),
      }));

      span.setAttribute("issue_count", issues.length);
      span.setAttribute("has_next_page", nextOffset !== null);
      span.setAttribute(
        "assigned_issue_count",
        workspaces.reduce(
          (total, workspace) => total + workspace.assigned_issue_count,
          0,
        ),
      );
      return {
        issues,
        workspaces,
        next_offset: nextOffset,
        as_of: asOf,
      };
    },
  );
}
