import { describe, expect, it } from "vitest";
import {
  MAX_REORDER_WRITES,
  RANK_NULL_SORT_SENTINEL,
  RANK_STEP,
  type RankedItem,
  backlogRankSortKey,
  computeReorderedRanks,
  mapJiraRanksToIssueOrder,
} from "./backlogRank";

function items(...specs: Array<[string, number | null]>): RankedItem[] {
  return specs.map(([id, rank]) => ({ id, rank }));
}

/** Apply the reorder result to a copy, then read the resulting display order
 *  (ranked asc, unranked last by input order) to assert the realized sequence. */
function applyAndOrder(
  ordered: RankedItem[],
  updates: ReturnType<typeof computeReorderedRanks>,
): string[] {
  const byId = new Map(ordered.map((i) => [i.id, { ...i }]));
  for (const u of updates) {
    const row = byId.get(u.id);
    if (row) row.rank = u.rank;
  }
  // Stable sort by sort key; ties keep original array order (the tail's stable
  // newest-first order is modeled by the caller's input order here).
  return [...byId.values()]
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const ka = backlogRankSortKey(a.row.rank);
      const kb = backlogRankSortKey(b.row.rank);
      return ka === kb ? a.idx - b.idx : ka - kb;
    })
    .map((x) => x.row.id);
}

describe("backlogRankSortKey", () => {
  it("collapses an unranked row to the sentinel so it sinks below ranked rows", () => {
    expect(backlogRankSortKey(null)).toBe(RANK_NULL_SORT_SENTINEL);
    expect(backlogRankSortKey(undefined)).toBe(RANK_NULL_SORT_SENTINEL);
    expect(backlogRankSortKey(500)).toBe(500);
    expect(500).toBeLessThan(RANK_NULL_SORT_SENTINEL);
  });
});

describe("mapJiraRanksToIssueOrder", () => {
  it("maps distinct Jira Rank strings to sparse reef ranks in Jira order (REEF-393)", () => {
    const mapped = mapJiraRanksToIssueOrder([
      { id: "REEF-2", jiraRank: "0|i00020:" },
      { id: "REEF-1", jiraRank: "0|i00010:" },
      { id: "REEF-3", jiraRank: "0|i00030:" },
    ]);

    expect(mapped).toEqual([
      {
        id: "REEF-2",
        jiraRank: "0|i00020:",
        rank: 2 * RANK_STEP,
        classification: "rank_mapped",
      },
      {
        id: "REEF-1",
        jiraRank: "0|i00010:",
        rank: RANK_STEP,
        classification: "rank_mapped",
      },
      {
        id: "REEF-3",
        jiraRank: "0|i00030:",
        rank: 3 * RANK_STEP,
        classification: "rank_mapped",
      },
    ]);
  });

  it("classifies missing and duplicate Jira Rank values as rank_unmapped", () => {
    const mapped = mapJiraRanksToIssueOrder([
      { id: "REEF-1", jiraRank: "0|same:" },
      { id: "REEF-2", jiraRank: "   " },
      { id: "REEF-3", jiraRank: "0|same:" },
      { id: "REEF-4", jiraRank: null },
    ]);

    expect(mapped).toEqual([
      {
        id: "REEF-1",
        jiraRank: "0|same:",
        rank: null,
        classification: "rank_unmapped",
        reason: "duplicate_jira_rank",
      },
      {
        id: "REEF-2",
        jiraRank: null,
        rank: null,
        classification: "rank_unmapped",
        reason: "missing_jira_rank",
      },
      {
        id: "REEF-3",
        jiraRank: "0|same:",
        rank: null,
        classification: "rank_unmapped",
        reason: "duplicate_jira_rank",
      },
      {
        id: "REEF-4",
        jiraRank: null,
        rank: null,
        classification: "rank_unmapped",
        reason: "missing_jira_rank",
      },
    ]);
  });

  it("keeps backlog drag-reorder midpoint writes valid over migrated ranks", () => {
    const mapped = mapJiraRanksToIssueOrder([
      { id: "A", jiraRank: "0|a:" },
      { id: "B", jiraRank: "0|b:" },
      { id: "C", jiraRank: "0|c:" },
    ]);
    const list = mapped.map((m) => ({ id: m.id, rank: m.rank }));

    const updates = computeReorderedRanks(list, 2, 1);

    expect(updates).toEqual([{ id: "C", rank: 1500 }]);
    expect(applyAndOrder(list, updates)).toEqual(["A", "C", "B"]);
  });
});

describe("computeReorderedRanks — no-op / bounds", () => {
  it("returns no writes when from === to or indices are out of range", () => {
    const list = items(["A", 1000], ["B", 2000]);
    expect(computeReorderedRanks(list, 0, 0)).toEqual([]);
    expect(computeReorderedRanks(list, -1, 1)).toEqual([]);
    expect(computeReorderedRanks(list, 0, 5)).toEqual([]);
  });
});

describe("computeReorderedRanks — steady state (AC2/AC3: one-row writes)", () => {
  it("writes only the moved row to the midpoint between two ranked neighbors", () => {
    // A(1000) B(2000) C(3000); move C up between A and B.
    const list = items(["A", 1000], ["B", 2000], ["C", 3000]);
    const updates = computeReorderedRanks(list, 2, 1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ id: "C", rank: 1500 });
    expect(applyAndOrder(list, updates)).toEqual(["A", "C", "B"]);
  });

  it("writes one row above the top ranked row when dropped at the top", () => {
    const list = items(["A", 1000], ["B", 2000], ["C", 3000]);
    const updates = computeReorderedRanks(list, 2, 0);
    expect(updates).toEqual([{ id: "C", rank: 1000 - RANK_STEP }]);
    expect(applyAndOrder(list, updates)).toEqual(["C", "A", "B"]);
  });

  it("writes one row below the bottom ranked row when dropped at the bottom", () => {
    const list = items(["A", 1000], ["B", 2000], ["C", 3000]);
    const updates = computeReorderedRanks(list, 0, 2);
    expect(updates).toEqual([{ id: "A", rank: 3000 + RANK_STEP }]);
    expect(applyAndOrder(list, updates)).toEqual(["B", "C", "A"]);
  });
});

describe("computeReorderedRanks — unranked tail (AC4)", () => {
  it("assigns one rank to lift an unranked row up against the curated zone", () => {
    // Curated A(1000) B(2000), then unranked tail X, Y. Lift X to position 1
    // (between A and B): a single midpoint write, no neighbor materialized.
    const list = items(["A", 1000], ["B", 2000], ["X", null], ["Y", null]);
    const updates = computeReorderedRanks(list, 2, 1);
    expect(updates).toEqual([{ id: "X", rank: 1500 }]);
    expect(applyAndOrder(list, updates)).toEqual(["A", "X", "B", "Y"]);
  });

  it("lifts an unranked row below the curated zone with one write", () => {
    // Drop Y right after the curated zone (from the tail at index 3 to index 2):
    // one row, lo+STEP, no neighbor materialized.
    const list = items(["A", 1000], ["B", 2000], ["X", null], ["Y", null]);
    const updates = computeReorderedRanks(list, 3, 2);
    expect(updates).toEqual([{ id: "Y", rank: 2000 + RANK_STEP }]);
    expect(applyAndOrder(list, updates)).toEqual(["A", "B", "Y", "X"]);
  });

  it("first reorder in a fully-unranked backlog: drag to top is one write", () => {
    const list = items(["X", null], ["Y", null], ["Z", null]);
    const updates = computeReorderedRanks(list, 2, 0);
    expect(updates).toEqual([{ id: "Z", rank: RANK_STEP }]);
    expect(applyAndOrder(list, updates)).toEqual(["Z", "X", "Y"]);
  });

  it("first reorder in a fully-unranked backlog: dropping mid-tail materializes only the run down to the drop", () => {
    // X Y Z W (all unranked). Move W to position 1 (between X and Y). the
    // run from the top through the drop (X, W) is ranked; Y and Z stay unranked.
    const list = items(["X", null], ["Y", null], ["Z", null], ["W", null]);
    const updates = computeReorderedRanks(list, 3, 1);
    expect(updates).toEqual([
      { id: "X", rank: RANK_STEP },
      { id: "W", rank: 2 * RANK_STEP },
    ]);
    expect(applyAndOrder(list, updates)).toEqual(["X", "W", "Y", "Z"]);
  });

  it("drops a row to the bottom of the unranked tail without floating it back up (REEF-129)", () => {
    // A(1000) B(2000) then unranked X, Y, Z. Drag X to the very bottom — it should
    // end below Y and Z, not snap back up against the curated zone.
    const list = items(
      ["A", 1000],
      ["B", 2000],
      ["X", null],
      ["Y", null],
      ["Z", null],
    );
    const updates = computeReorderedRanks(list, 2, 4);
    expect(applyAndOrder(list, updates)).toEqual(["A", "B", "Y", "Z", "X"]);
    // tail rows from the curated boundary through the drop are touched.
    expect(updates.every((u) => ["X", "Y", "Z"].includes(u.id))).toBe(true);
  });
});

describe("computeReorderedRanks — AC2 bounded writes / never the whole backlog", () => {
  it("never rewrites the unranked tail when lifting from it", () => {
    const list = items(
      ["A", 1000],
      ["B", 2000],
      ["X", null],
      ["Y", null],
      ["Z", null],
    );
    const updates = computeReorderedRanks(list, 4, 1); // lift Z between A and B
    expect(updates).toEqual([{ id: "Z", rank: 1500 }]);
    // Y and X (the rest of the tail) are untouched.
    expect(updates.some((u) => u.id === "X" || u.id === "Y")).toBe(false);
  });

  it("clamps a very deep unranked-tail drop to the write cap (REEF-129)", () => {
    // A fully-unranked backlog larger than the bound; dragging the top row to the
    // very bottom would naively materialize every row. The clamp keeps the write
    // set within MAX_REORDER_WRITES so the equally-capped request schema does not
    // rejects a valid drag.
    const n = MAX_REORDER_WRITES + 50;
    const list: RankedItem[] = Array.from({ length: n }, (_, i) => ({
      id: `REEF-${i}`,
      rank: null,
    }));
    const updates = computeReorderedRanks(list, 0, n - 1);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThanOrEqual(MAX_REORDER_WRITES);
  });

  it("bounds the re-space to the write cap even for a huge curated zone (REEF-129)", () => {
    // A curated zone larger than the cap. Two adjacent rows are float-adjacent,
    // so inserting between them exhausts the midpoint and triggers the re-space;
    // the windowed re-space should keep the payload within MAX_REORDER_WRITES.
    const n = MAX_REORDER_WRITES + 50;
    const list: RankedItem[] = Array.from({ length: n }, (_, i) => ({
      id: `REEF-${i}`,
      rank: i + 2,
    }));
    list[0].rank = 1;
    list[1].rank = 1 + Number.EPSILON; // 1 < 1+eps < list[2].rank, still ascending
    const updates = computeReorderedRanks(list, 5, 1);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThanOrEqual(MAX_REORDER_WRITES);
  });

  it("re-spaces only the curated zone (not the tail) when a midpoint is exhausted", () => {
    // Two adjacent ranks with no float64 value strictly between them, a third
    // ranked row, and an unranked tail. Dropping a row between the exhausted pair
    // re-spaces the curated zone and leaves the tail untouched.
    const lo = 1;
    const hi = lo + Number.EPSILON; // no double strictly between lo and hi
    const list: RankedItem[] = [
      { id: "A", rank: lo },
      { id: "B", rank: hi },
      { id: "C", rank: 3000 },
      { id: "D", rank: null },
    ];
    // Move C between A and B (its midpoint between lo and hi is unrepresentable).
    const updates = computeReorderedRanks(list, 2, 1);
    // The tail row is does not part of the re-space.
    expect(updates.some((u) => u.id === "D")).toBe(false);
    // Curated rows get clean sparse ranks again.
    for (const u of updates) {
      expect(Number.isInteger(u.rank)).toBe(true);
      expect(u.rank).toBeGreaterThanOrEqual(RANK_STEP);
    }
  });
});
