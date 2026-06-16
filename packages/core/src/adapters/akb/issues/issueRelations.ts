import { nextIssueId, parseIssueId } from "../../../models/id";
import {
  type IssueRelation,
  IssueRelationSchema,
} from "../../../schemas/issues/requests";
import {
  type AkbAdapter,
  REEF_ISSUES_TABLE,
  decodeStringArray,
  isMissingTableError,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import type { AllocateNextIssueIdParams } from "../core/types";

/**
 * The whole-vault relation projection — `reef_id` / `status` / `depends_on`
 * just, no document body. Powers client-side blocker badges and the
 * blocked/blocking dependency filter under server-side filtered/paginated
 * lists, where the displayed page is a subset of the graph. A does not-onboarded
 * vault (missing table) resolves to an empty projection.
 */
export async function listIssueRelations(
  adapter: AkbAdapter,
  vault: string,
): Promise<IssueRelation[]> {
  return withSpan("akb.list_issue_relations", { vault }, async (span) => {
    let items: Record<string, unknown>[];
    try {
      const res = await runSql(
        adapter,
        vault,
        `SELECT "reef_id", "status", "depends_on" FROM ${tableRef(
          REEF_ISSUES_TABLE,
        )}`,
      );
      items = res.kind === "table_query" ? res.items : [];
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return [];
      }
      throw err;
    }
    const relations: IssueRelation[] = [];
    for (const row of items) {
      try {
        relations.push(
          IssueRelationSchema.parse({
            id: row.reef_id,
            status: row.status,
            // akb may return the json `depends_on` column as a JSON-text
            // string; reuse the same decoder `rowToIssue` uses so dependencies
            // are not silently dropped to [].
            depends_on: decodeStringArray(row.depends_on) ?? [],
          }),
        );
      } catch {
        // Skip a malformed relation row rather than failing the projection.
      }
    }
    span.setAttribute("relation_count", relations.length);
    return relations;
  });
}

/**
 * Compute the next sequential ID in a vault by taking the max-allocated number
 * across the `reef_issues` table. A single `SELECT reef_id` — no document body
 * fetch. Shared by the two POST endpoints (`/api/issues`, `/api/drafts/approve`).
 */
export async function allocateNextIssueId(
  params: AllocateNextIssueIdParams,
): Promise<string> {
  const { adapter, vault, prefix } = params;
  return withSpan("akb.allocate_next_issue_id", { vault }, async (span) => {
    let rows: Record<string, unknown>[] = [];
    try {
      const res = await runSql(
        adapter,
        vault,
        `SELECT reef_id FROM ${tableRef(REEF_ISSUES_TABLE)}`,
      );
      rows = res.kind === "table_query" ? res.items : [];
    } catch (err) {
      // No table yet → no issues allocated → start at the prefix's first id.
      if (!isMissingTableError(err)) throw err;
    }
    const currentMax = rows.reduce((max, row) => {
      try {
        return Math.max(max, parseIssueId(String(row.reef_id)).number);
      } catch {
        return max;
      }
    }, 0);
    span.setAttribute("current_max", currentMax);
    return nextIssueId({ prefix, currentMax });
  });
}
