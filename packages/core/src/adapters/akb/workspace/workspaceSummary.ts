import type { WorkspaceSummary } from "../../../schemas/ai/chatGrounding";
import {
  type AkbAdapter,
  REEF_ISSUES_TABLE,
  isMissingTableError,
  runSql,
  withSpan,
} from "../core/shared";
import { listPlanningCatalog } from "../planning/planning";

export interface GetWorkspaceSummaryParams {
  adapter: AkbAdapter;
  vault: string;
}

/**
 * Terminal statuses excluded from the "open" count. Kept as literals (not the
 * StatusEnum import) so the summary stays a cheap read; keep in sync with
 * `StatusEnum` if a terminal status is ever added.
 */
const TERMINAL_STATUSES = new Set(["done", "closed"]);

/**
 * Read a compact, credential-safe workspace summary for chat grounding
 * (REEF-360 AC1): the active sprint (name + goal) and open-issue counts by
 * status. Composes the existing planning-catalog read with a single
 * count-by-status SQL aggregate — no per-issue body fetch.
 *
 * Best-effort by construction: a brand-new vault with no reef tables yields an
 * empty summary rather than an error, so chat still grounds on the vault name.
 * Callers should additionally treat a thrown error as "no summary" and degrade.
 */
export async function getWorkspaceSummary({
  adapter,
  vault,
}: GetWorkspaceSummaryParams): Promise<WorkspaceSummary> {
  return withSpan("akb.workspace_summary", { vault }, async (span) => {
    const [activeSprint, statusCounts] = await Promise.all([
      resolveActiveSprint(adapter, vault),
      countIssuesByStatus(adapter, vault),
    ]);
    const openIssueCount = statusCounts
      .filter((entry) => !TERMINAL_STATUSES.has(entry.status))
      .reduce((total, entry) => total + entry.count, 0);
    span.setAttribute("has_active_sprint", activeSprint != null);
    span.setAttribute("open_issue_count", openIssueCount);
    return { vault, activeSprint, openIssueCount, statusCounts };
  });
}

async function resolveActiveSprint(
  adapter: AkbAdapter,
  vault: string,
): Promise<WorkspaceSummary["activeSprint"]> {
  const catalog = await listPlanningCatalog({ adapter, vault });
  const active = catalog.sprints.find((sprint) => sprint.status === "active");
  if (!active) return null;
  return { name: active.name, goal: active.goal ? active.goal : null };
}

async function countIssuesByStatus(
  adapter: AkbAdapter,
  vault: string,
): Promise<WorkspaceSummary["statusCounts"]> {
  try {
    const response = await runSql(
      adapter,
      vault,
      `SELECT status, COUNT(*)::int AS count FROM ${REEF_ISSUES_TABLE} WHERE archived_at IS NULL GROUP BY status`,
    );
    if (response.kind !== "table_query") return [];
    return response.items
      .map((row) => ({
        status: typeof row.status === "string" ? row.status : "",
        count: coerceCount(row.count),
      }))
      .filter((entry) => entry.status !== "");
  } catch (err) {
    // A vault that has never onboarded reef has no reef_issues table yet — an
    // empty board, not an error.
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

function coerceCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}
