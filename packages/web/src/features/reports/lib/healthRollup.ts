import {
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import {
  type IssueListItem,
  type Milestone,
  type PlanningCatalog,
  type Release,
  type Sprint,
  isResolvedStatus,
} from "@reef/core";
import {
  DAY_MS,
  DEFAULT_REPORT_FILTERS,
  REPORT_PERIOD_WEEKS,
  type ReportFilters,
  WEEK_MS,
  completionTime,
  isOpenReportWork,
  matchesFilters,
} from "./aggregateModel";

/**
 * Per-planning-item health rollup (REEF-191). A pure derivation over the
 * already-loaded issue list — it lives beside `computeAggregates` in the web
 * reports feature rather than in `core`, because the reports aggregation
 * pipeline (its blocker/aging/throughput classifiers, `matchesFilters`) is a
 * web-local concern operating on `IssueListItem`s the client already holds, not
 * a data-plane boundary call.
 *
 * The RAG thresholds live in `classifyHealth`, so the
 * verdict stays "clear and consistent" (REEF-191 AC3). `computeHealthRollup`
 * function normalizes each planning item's linked issues into the `HealthInput`
 * that function judges.
 */

export type RollupDimension = "milestone" | "sprint" | "release";

/** Worst-first; an empty item (no linked issues) has no verdict and sorts last. */
export type RagLevel = "off_track" | "at_risk" | "on_track";

/** The three dimensions in display order — theme, then timebox, then shipment. */
export const ROLLUP_DIMENSIONS: readonly RollupDimension[] = [
  "milestone",
  "sprint",
  "release",
] as const;

/** Render rank for worst-first sort; `empty` (null verdict) sorts last. */
const RAG_RANK: Record<RagLevel, number> = {
  off_track: 0,
  at_risk: 1,
  on_track: 2,
};

/** The normalized signals `classifyHealth` judges. Pre-normalizing the
 *  dimension-specific bits (which completion to use, the time anchor) upstream
 *  keeps the threshold function itself dimension-agnostic — one rule set. */
export interface HealthInput {
  /** Open work past its due date. */
  overdue: number;
  /** Open work with an unresolved blocker. */
  blocked: number;
  /** Net throughput over the period window (created − closed); >0 = growing. */
  net: number;
  /** 0..1 progress used for pace — issue completion, or capacity burn for a
   *  sprint with `capacity_points`. May exceed 1 when ahead of capacity. */
  completion: number;
  /** 0..1 fraction of the item's timeline elapsed, or null with no time anchor. */
  elapsedFraction: number | null;
  /** Hard deadline already passed with work still open (and not shipped). */
  targetPassed: boolean;
}

export interface HealthVerdict {
  level: RagLevel;
  /** The dominant driving signal, surfaced as a caption so the verdict is
   *  auditable rather than a black box. */
  reason: string;
}

export interface HealthRollupRow {
  id: string;
  name: string;
  kind: RollupDimension;
  /** Closed milestone / released release / closed sprint — finished work,
   *  de-emphasized and hidden unless "show shipped" is on. */
  shipped: boolean;
  /** The item's deadline (milestone/release `target_date`, sprint `end_date`). */
  targetDate: string | null;
  total: number;
  resolved: number;
  open: number;
  overdue: number;
  blocked: number;
  net: number;
  /** Issue-count completion (resolved / total), for the progress bar. */
  completion: number;
  /** null when the item has no linked issues in scope. */
  verdict: HealthVerdict | null;
}

/**
 * The single source of RAG thresholds (REEF-191 AC3). Evaluated worst-first;
 * the first matching clause wins and supplies the caption.
 */
export function classifyHealth(input: HealthInput): HealthVerdict {
  const { overdue, blocked, net, completion, elapsedFraction, targetPassed } =
    input;
  const paceDeficit =
    elapsedFraction == null ? 0 : elapsedFraction - completion;

  // Off track — a missed deadline, or far enough behind that catch-up is unlikely.
  if (targetPassed) {
    return { level: "off_track", reason: "past target, incomplete" };
  }
  if (overdue > 0 && elapsedFraction != null && elapsedFraction >= 0.5) {
    return { level: "off_track", reason: `${overdue} overdue, past mid-point` };
  }
  if (paceDeficit >= 0.25) {
    return { level: "off_track", reason: "well behind schedule" };
  }

  // At risk — a real warning signal, but still recoverable.
  if (overdue > 0) {
    return { level: "at_risk", reason: `${overdue} overdue` };
  }
  if (blocked > 0) {
    return { level: "at_risk", reason: `${blocked} blocked` };
  }
  if (paceDeficit >= 0.1) {
    return { level: "at_risk", reason: "behind schedule" };
  }
  if (net > 0) {
    return { level: "at_risk", reason: `backlog +${net}` };
  }

  return { level: "on_track", reason: "on track" };
}

export interface HealthRollupOptions {
  dimension: RollupDimension;
  catalog: PlanningCatalog;
  filters?: ReportFilters;
  /** Reference "now" (ms epoch); injectable for tests. Defaults to Date.now(). */
  now?: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** The `reef_issues` foreign-key column for a rollup dimension. */
const AXIS_KEY: Record<
  RollupDimension,
  "milestone_id" | "sprint_id" | "release_id"
> = {
  milestone: "milestone_id",
  sprint: "sprint_id",
  release: "release_id",
};

function catalogItems(
  catalog: PlanningCatalog,
  dimension: RollupDimension,
): ReadonlyArray<Milestone | Sprint | Release> {
  if (dimension === "milestone") return catalog.milestones;
  if (dimension === "sprint") return catalog.sprints;
  return catalog.releases;
}

function isShipped(
  item: Milestone | Sprint | Release,
  dimension: RollupDimension,
): boolean {
  if (dimension === "release") return item.status === "released";
  // milestone and sprint both use `closed` as their completed status.
  return item.status === "closed";
}

/** The item's deadline anchor: milestone/release `target_date`, sprint `end_date`. */
function targetDateOf(
  item: Milestone | Sprint | Release,
  dimension: RollupDimension,
): string | null {
  if (dimension === "sprint") return (item as Sprint).end_date ?? null;
  return (item as Milestone | Release).target_date ?? null;
}

/** Per-item accumulation over its linked, in-scope issues. */
interface GroupStats {
  total: number;
  resolved: number;
  open: number;
  overdue: number;
  blocked: number;
  createdInWindow: number;
  closedInWindow: number;
  minCreated: number; // earliest created_at (ms), used as the timeline start
  donePoints: number; // sum of estimate_points over resolved issues
}

function emptyStats(): GroupStats {
  return {
    total: 0,
    resolved: 0,
    open: 0,
    overdue: 0,
    blocked: 0,
    createdInWindow: 0,
    closedInWindow: 0,
    minCreated: Number.POSITIVE_INFINITY,
    donePoints: 0,
  };
}

/**
 * Roll up per-item health for one planning dimension, worst-first. Honors the
 * non-grouping report filters (period / scope / assignee / label, plus the
 * *other* two planning axes) but ignores the current axis's own filter so every
 * item of the dimension is shown — the row click is what scopes the page to one
 * item (REEF-191).
 */
export function computeHealthRollup(
  issues: ReadonlyArray<IssueListItem>,
  options: HealthRollupOptions,
): HealthRollupRow[] {
  const {
    dimension,
    catalog,
    filters = DEFAULT_REPORT_FILTERS,
    now = Date.now(),
  } = options;
  const axisKey = AXIS_KEY[dimension];

  // Ignore the current axis's own filter so the rollup lists every item; keep
  // every other facet (period/scope/assignee/label + the other planning axes).
  const rollupFilters: ReportFilters = { ...filters, [axisKey]: undefined };
  const matched = issues.filter((issue) =>
    matchesFilters(issue, rollupFilters),
  );

  const dependencyIndex = indexIssuesById(issues);

  const throughputWeeks =
    filters.period === "all" ? 26 : REPORT_PERIOD_WEEKS[filters.period];
  const todayEnd = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  const seriesStart = todayEnd - throughputWeeks * WEEK_MS;
  const inWindow = (t: number): boolean =>
    !Number.isNaN(t) && t >= seriesStart && t < todayEnd;

  const groups = new Map<string, GroupStats>();
  for (const issue of matched) {
    const gid = issue[axisKey];
    if (!gid) continue;
    let stats = groups.get(gid);
    if (!stats) {
      stats = emptyStats();
      groups.set(gid, stats);
    }
    stats.total++;

    const created = Date.parse(issue.created_at);
    if (created < stats.minCreated) stats.minCreated = created;
    if (inWindow(created)) stats.createdInWindow++;
    const closed = completionTime(issue);
    if (closed != null && inWindow(closed)) stats.closedInWindow++;

    if (isResolvedStatus(issue.status)) {
      stats.resolved++;
      stats.donePoints += issue.estimate_points ?? 0;
    } else if (isOpenReportWork(issue)) {
      stats.open++;
      if (issue.due_date && Date.parse(issue.due_date) < now) stats.overdue++;
      if (unresolvedBlockerCountIn(issue, dependencyIndex) > 0) stats.blocked++;
    }
  }

  const rows: HealthRollupRow[] = catalogItems(catalog, dimension).map(
    (item) => {
      const stats = groups.get(item.id) ?? emptyStats();
      const shipped = isShipped(item, dimension);
      const targetDate = targetDateOf(item, dimension);
      const completion = stats.total > 0 ? stats.resolved / stats.total : 0;
      const net = stats.createdInWindow - stats.closedInWindow;

      let verdict: HealthVerdict | null;
      if (stats.total === 0) {
        verdict = null; // empty item — nothing to judge
      } else if (shipped) {
        // Finished work is on track by definition; a closed/released item should
        // not read as off track.
        verdict = { level: "on_track", reason: "shipped" };
      } else {
        // Timeline anchor: explicit start (sprint) else earliest linked issue.
        const startMs =
          dimension === "sprint" && (item as Sprint).start_date
            ? Date.parse((item as Sprint).start_date as string)
            : stats.minCreated;
        const endMs = targetDate ? Date.parse(targetDate) : Number.NaN;
        const hasAnchor =
          !Number.isNaN(endMs) && Number.isFinite(startMs) && endMs > startMs;
        const elapsedFraction = hasAnchor
          ? clamp01((now - startMs) / (endMs - startMs))
          : null;
        const targetPassed =
          !Number.isNaN(endMs) && endMs < now && completion < 1;

        // Pace uses capacity burn for a sprint that declared capacity; otherwise
        // issue completion. (capacity_points null → graceful fallback.)
        const capacity =
          dimension === "sprint" ? (item as Sprint).capacity_points : null;
        const paceCompletion =
          capacity && capacity > 0 ? stats.donePoints / capacity : completion;

        verdict = classifyHealth({
          overdue: stats.overdue,
          blocked: stats.blocked,
          net,
          completion: paceCompletion,
          elapsedFraction,
          targetPassed,
        });
      }

      return {
        id: item.id,
        name: item.name,
        kind: dimension,
        shipped,
        targetDate,
        total: stats.total,
        resolved: stats.resolved,
        open: stats.open,
        overdue: stats.overdue,
        blocked: stats.blocked,
        net,
        completion,
        verdict,
      };
    },
  );

  return rows.sort((a, b) => {
    const aRank = a.verdict ? RAG_RANK[a.verdict.level] : 3;
    const bRank = b.verdict ? RAG_RANK[b.verdict.level] : 3;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}
