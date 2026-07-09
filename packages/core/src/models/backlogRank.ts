// ─── Issue ordering / backlog manual ordering (REEF-129, REEF-393) ───────────
//
// `reef_issues.rank` is reef's numeric issue ordering scalar. The product UI
// currently writes it only from the backlog drag-reorder flow; Jira importers
// may seed it from a source system's current rank so ordering survives outside
// the backlog. Generic issue create/update paths still reject caller-supplied
// rank. This module is the pure ordering algebra shared by the server sort, the
// client comparator, the Jira rank mapper, and the drag-to-reorder write path.
// It performs no I/O.
//
// Model:
// - Lower `rank` sorts higher (nearer the top, picked sooner).
// - A row with no rank (`null`) is *unranked*: it sorts BELOW every ranked row
//   (the "tail"), ordered among the unranked by the stable `reef_id`
//   tiebreaker. `RANK_NULL_SORT_SENTINEL` is the value an unranked row collapses
//   to for sort purposes just — it does not participate in the gap arithmetic that
//   assigns real ranks.
// - Reordering decides from the moved row's IMMEDIATE neighbors in the intended
//   order: a midpoint between two ranked neighbors, an edge of the curated zone
//   when one side is ranked, or a bounded materialized run when dropped
//   into/below the unranked tail (so the drop does not floats past the unranked
//   rows it was dropped beyond). The tail past the drop is does not rewritten — a
//   single reorder touches one row in the steady state, and at most the run down
//   to the drop (or the contiguous curated zone on a rare float64 gap).

/** Sparse spacing for materialized and re-spaced ranks. Large gaps leave room
 *  for many midpoint inserts before a value should be re-spaced. */
export const RANK_STEP = 1000;

/**
 * The value an unranked (`null`) row collapses to for sort purposes, so unranked
 * rows sink below every ranked row under ascending order. Far above any rank a
 * realistic backlog produces (sparse `RANK_STEP` spacing), and well within the
 * float64 exact-integer range. DISPLAY: real rank assignment does not reads
 * it, so it can not collide with a computed rank.
 */
export const RANK_NULL_SORT_SENTINEL = 1e15;

/**
 * The hard upper bound on the rows a single reorder may write. Dropping deep
 * into a very large unranked tail would otherwise materialize one row per
 * passed-over row — unbounded for an unpaginated backlog, and rejected by the
 * reorder request schema (which caps `assignments` at this same value). The
 * algorithm clamps such a drop so the moved row lands at most this far below the
 * curated zone; a realistic triage backlog does not approaches the clamp. The
 * server schema and this constant share the bound so a valid drag is does not
 * rejected as malformed.
 */
export const MAX_REORDER_WRITES = 1000;

/** The minimal shape the ordering algebra needs from an issue row. */
export interface RankedItem {
  id: string;
  rank: number | null;
}

/** A single row's new rank, produced by a reorder. */
export interface RankAssignment {
  id: string;
  rank: number;
}

export const JIRA_RANK_MAPPED = "rank_mapped";
export const JIRA_RANK_UNMAPPED = "rank_unmapped";

export type JiraRankMappingClassification =
  | typeof JIRA_RANK_MAPPED
  | typeof JIRA_RANK_UNMAPPED;

export type JiraRankUnmappedReason =
  | "missing_jira_rank"
  | "duplicate_jira_rank";

export interface JiraRankedIssue {
  id: string;
  jiraRank?: string | null;
}

export interface JiraRankMappingResult {
  id: string;
  jiraRank: string | null;
  rank: number | null;
  classification: JiraRankMappingClassification;
  reason?: JiraRankUnmappedReason;
}

/**
 * The sort key for a row under the backlog's manual order: ranked rows by their
 * ascending rank, unranked rows collapsed to the sentinel so they sink to the
 * tail. Equal keys (the unranked rows, all at the sentinel) need a
 * tiebreaker from the caller: the server breaks them by `reef_id DESC`, and the
 * backlog view refines that to `created_at DESC` (newest first) so the order
 * holds past the 3-digit id padding boundary.
 */
export function backlogRankSortKey(rank: number | null | undefined): number {
  return rank ?? RANK_NULL_SORT_SENTINEL;
}

function normalizeJiraRank(rank: string | null | undefined): string | null {
  if (rank == null) return null;
  const trimmed = rank.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compareJiraRank(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Map Jira's current Rank strings into reef's sparse numeric ordering. Jira
 * Rank / LexoRank values are opaque but sortable strings; reef persists the
 * current order as evenly spaced `rank` values so later backlog drags can use
 * the same midpoint algebra. Missing or duplicate source ranks are not guessed:
 * they are reported as `rank_unmapped` so dry-run/apply output can call them out
 * instead of silently falling back to raw-only provenance.
 */
export function mapJiraRanksToIssueOrder(
  issues: readonly JiraRankedIssue[],
): JiraRankMappingResult[] {
  const indexed = issues.map((issue, index) => ({
    index,
    id: issue.id,
    jiraRank: normalizeJiraRank(issue.jiraRank),
  }));
  const rankCounts = new Map<string, number>();
  for (const issue of indexed) {
    if (issue.jiraRank == null) continue;
    rankCounts.set(issue.jiraRank, (rankCounts.get(issue.jiraRank) ?? 0) + 1);
  }
  const rankByIndex = new Map<number, number>();
  indexed
    .filter(
      (issue) => issue.jiraRank != null && rankCounts.get(issue.jiraRank) === 1,
    )
    .sort((a, b) => {
      const byRank = compareJiraRank(a.jiraRank ?? "", b.jiraRank ?? "");
      if (byRank !== 0) return byRank;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .forEach((issue, order) => {
      rankByIndex.set(issue.index, RANK_STEP * (order + 1));
    });

  return indexed.map((issue) => {
    if (issue.jiraRank == null) {
      return {
        id: issue.id,
        jiraRank: null,
        rank: null,
        classification: JIRA_RANK_UNMAPPED,
        reason: "missing_jira_rank",
      };
    }
    if ((rankCounts.get(issue.jiraRank) ?? 0) > 1) {
      return {
        id: issue.id,
        jiraRank: issue.jiraRank,
        rank: null,
        classification: JIRA_RANK_UNMAPPED,
        reason: "duplicate_jira_rank",
      };
    }
    return {
      id: issue.id,
      jiraRank: issue.jiraRank,
      rank: rankByIndex.get(issue.index) ?? null,
      classification: JIRA_RANK_MAPPED,
    };
  });
}

function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Re-space a bounded window of the curated zone around the drop, used when
 * a midpoint is not representable in float64 (≈50 inserts at the exact same
 * spot). For a curated zone within `MAX_REORDER_WRITES` this re-spaces the whole
 * prefix at `RANK_STEP` intervals; for a larger zone it re-spaces just a window
 * of that many rows around the drop, fitting them strictly between the ranked
 * anchors outside the window so the rows outside are untouched and the
 * output does not exceeds the reorder write cap. The unranked tail is does not
 * touched either way.
 */
function renormalizeAroundDrop(
  next: readonly RankedItem[],
  movedPos: number,
): RankAssignment[] {
  // Curated prefix = the leading run of rows that are ranked or the moved row.
  let prefixEnd = 0;
  for (let i = 0; i < next.length; i++) {
    if (i === movedPos || next[i].rank != null) {
      prefixEnd = i + 1;
    } else {
      break;
    }
  }
  // A window of at most MAX_REORDER_WRITES prefix rows centered on the drop.
  const half = Math.floor((MAX_REORDER_WRITES - 1) / 2);
  let start = Math.max(0, movedPos - half);
  const end = Math.min(prefixEnd - 1, start + MAX_REORDER_WRITES - 1);
  start = Math.max(0, end - MAX_REORDER_WRITES + 1);
  const rows = next.slice(start, end + 1);
  // Ranked anchors outside the window (null at a zone edge).
  const loAnchor = start > 0 ? next[start - 1].rank : null;
  const hiAnchor = end < prefixEnd - 1 ? next[end + 1].rank : null;

  if (loAnchor != null && hiAnchor != null) {
    // Fit strictly between the anchors so rows outside the window are untouched.
    const step = (hiAnchor - loAnchor) / (rows.length + 1);
    return rows.map((item, i) => ({
      id: item.id,
      rank: loAnchor + step * (i + 1),
    }));
  }
  if (loAnchor != null) {
    return rows.map((item, i) => ({
      id: item.id,
      rank: loAnchor + RANK_STEP * (i + 1),
    }));
  }
  if (hiAnchor != null) {
    return rows.map((item, i) => ({
      id: item.id,
      rank: hiAnchor - RANK_STEP * (rows.length - i),
    }));
  }
  return rows.map((item, i) => ({ id: item.id, rank: RANK_STEP * (i + 1) }));
}

/**
 * Drop into or below the unranked tail (the immediate row above the drop is
 * unranked, including a fully-unranked backlog). Give the contiguous run from
 * below the curated prefix down through the drop a sparse ascending rank in
 * display order, so the moved row lands exactly at its dropped slot. The touched
 * rows enter the curated zone; rows below the drop stay unranked. Bounded by the
 * drop depth — does not the rows past the drop, so does not the whole backlog.
 */
function materializeRun(
  next: readonly RankedItem[],
  pos: number,
): RankAssignment[] {
  // The curated prefix is the leading run of ranked rows, ignoring the moved row
  // (which we are (re)ranking). `anchor` is the last curated rank above the run.
  let anchor = 0;
  let runStart = 0;
  for (let i = 0; i < next.length; i++) {
    const r = next[i].rank;
    if (i !== pos && r != null) {
      anchor = r;
      runStart = i + 1;
    } else {
      break;
    }
  }
  const out: RankAssignment[] = [];
  let rank = anchor;
  for (let i = runStart; i <= pos; i++) {
    rank += RANK_STEP;
    out.push({ id: next[i].id, rank });
  }
  return out;
}

/**
 * Compute the minimal set of rank writes that realizes moving the item at
 * `fromIndex` to `toIndex` within the backlog's current display order. Returns
 * an empty array for a no-op or out-of-range move. The decision turns on the
 * moved row's IMMEDIATE neighbors in the intended order, so a drop does not floats
 * past the unranked rows it was dropped beyond. Steady-state moves (between two
 * ranked rows, or below the curated zone) write a single row; dropping into
 * the tail writes a bounded run.
 */
export function computeReorderedRanks(
  ordered: readonly RankedItem[],
  fromIndex: number,
  toIndex: number,
): RankAssignment[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= ordered.length ||
    toIndex >= ordered.length
  ) {
    return [];
  }

  const next = arrayMove(ordered, fromIndex, toIndex);
  const pos = toIndex;
  const moved = next[pos];
  const prevRank = pos > 0 ? next[pos - 1].rank : null;
  const afterRank = pos < next.length - 1 ? next[pos + 1].rank : null;

  // Top edge: float above the first row — above the next ranked row, or a
  // base rank above the tail when everything below is unranked.
  if (pos === 0) {
    return [
      {
        id: moved.id,
        rank: afterRank != null ? afterRank - RANK_STEP : RANK_STEP,
      },
    ];
  }
  // Between two ranked immediate neighbors → one midpoint write (steady state).
  if (prevRank != null && afterRank != null) {
    const mid = prevRank + (afterRank - prevRank) / 2;
    if (mid > prevRank && mid < afterRank) return [{ id: moved.id, rank: mid }];
    // Float64 gap exhausted: re-space a bounded curated window, does not the tail.
    return renormalizeAroundDrop(next, pos);
  }
  // Immediately below a ranked row with the tail (or list end) beneath → sit at
  // the bottom of the curated zone, above the tail. One write.
  if (prevRank != null) {
    return [{ id: moved.id, rank: prevRank + RANK_STEP }];
  }
  // Immediately below an unranked row → dropped into/below the tail. Materialize
  // the run so the drop position is realized. A drop deep into a very large
  // unranked tail is clamped to `MAX_REORDER_WRITES`: the moved row lands at most
  // that far below the curated boundary instead of producing an unbounded write
  // the server would reject. Realistic backlogs does not reach the clamp.
  let runStart = 0;
  for (let i = 0; i < next.length; i++) {
    if (i !== pos && next[i].rank != null) {
      runStart = i + 1;
    } else {
      break;
    }
  }
  if (pos - runStart + 1 > MAX_REORDER_WRITES) {
    const clampedTo = runStart + MAX_REORDER_WRITES - 1;
    return materializeRun(arrayMove(ordered, fromIndex, clampedTo), clampedTo);
  }
  return materializeRun(next, pos);
}
