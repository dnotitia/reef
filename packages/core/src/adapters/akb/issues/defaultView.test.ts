import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  makeAdapter,
  setupFetch,
  sqlRequestBody,
} from "../core/httpTestSupport";
import { makeIssueQueryResponse } from "./issueFixtures";
import { encodeCursor } from "../core/shared";
import { listIssues } from "./issues";

const FLOOR = `"archived_at" IS NULL AND "status" IN ($1, $2, $3)`;
// The active-sprint pick, folded into the default-view query as a scalar
// subquery (REEF-324) instead of a separate `getActiveSprint` round-trip.
// AKB auto-generated ids are UUID; reef_issues.sprint_id is a TEXT reference.
const SPRINT_SUBQ = `(SELECT CAST("id" AS TEXT) FROM reef_sprints WHERE "status" = $4 ORDER BY "start_date" DESC NULLS LAST, "id" DESC LIMIT 1)`;
const SPRINT_FALLBACK = `(${SPRINT_SUBQ} IS NULL OR "sprint_id" = ${SPRINT_SUBQ})`;

const ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Fix login",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
  assigned_to: "alice",
};

describe("listIssues default_view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["alice", "a'b"])(
    "issues one combined parameterized query for actor %s",
    async (actor) => {
      const { calls } = setupFetch([
        { body: makeIssueQueryResponse([{ ...ISSUE, assigned_to: actor }]) },
      ]);
      const query = IssueListQuerySchema.parse({ default_view: true });
      const res = await listIssues({
        adapter: makeAdapter(),
        vault: "reef-acme",
        query,
        actor,
      });
      expect(res.issues).toHaveLength(1);
      // Folded: the old path cost 3 calls (active sprint + My-Issues probe + list).
      expect(calls).toHaveLength(1);
      const sql = sqlRequestBody(calls[0]).sql;
      const actorEq = `"assigned_to" = $5`;
      const hasMine = `EXISTS (SELECT 1 FROM reef_issues WHERE ${FLOOR} AND ${actorEq})`;
      expect(sql).toBe(
        `SELECT * FROM reef_issues WHERE ${FLOOR} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND ${SPRINT_FALLBACK}))`,
      );
      expect(sql).not.toContain(actor);
      expect(sqlRequestBody(calls[0]).params).toEqual([
        "todo",
        "in_progress",
        "in_review",
        "active",
        actor,
      ]);
    },
  );

  it("floors to the active sprint in one query when no actor is resolved", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    await listIssues({
      adapter: makeAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(calls).toHaveLength(1);
    const sql = sqlRequestBody(calls[0]).sql;
    expect(sql).toBe(
      `SELECT * FROM reef_issues WHERE ${FLOOR} AND ${SPRINT_FALLBACK}`,
    );
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("EXISTS");
    expect(sqlRequestBody(calls[0]).params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
    ]);
  });

  it("keeps the resolved scope and the keyset together in one query on cursor pages", async () => {
    const cursor = encodeCursor(
      { created_at: "2026-05-02T00:00:00.000Z", reef_id: "REEF-050" },
      "created_at",
    );
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({
      default_view: true,
      limit: 50,
      sort_field: "created_at",
      cursor,
    });
    await listIssues({
      adapter: makeAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // The combined default-view scope AND the keyset predicate land in the same
    // statement — page 2 keeps the up-front scope (My-Issues existence test),
    // not an empty My-Issues set.
    expect(calls).toHaveLength(1);
    const sql = sqlRequestBody(calls[0]).sql;
    expect(sql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(sql).toContain(SPRINT_SUBQ);
    expect(sql).toContain(`"created_at" < (($6::text)::timestamptz)`);
    expect(sqlRequestBody(calls[0]).params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
      "alice",
      "2026-05-02T00:00:00.000Z",
      50,
      51,
    ]);
  });

  it("lets explicit filters override default_view", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({
      default_view: true,
      status: ["done"],
    });
    await listIssues({
      adapter: makeAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // The default-view branch is skipped, so the WHERE is the explicit facet and
    // there is no folded sprint/EXISTS subquery.
    expect(calls).toHaveLength(1);
    const sql = sqlRequestBody(calls[0]).sql;
    expect(sql).toContain(`"status" IN ($1)`);
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("EXISTS");
    expect(sqlRequestBody(calls[0]).params).toEqual(["done"]);
  });

  it.each([{ actor: null }, { actor: "alice" }])(
    "falls back to a sprint-free query for actor $actor when reef_sprints is missing",
    async ({ actor }) => {
      const { calls } = setupFetch([
        // The folded query fails on the missing sprint table…
        {
          body: {
            error: 'relation "vt_reef-acme__reef_sprints" does not exist',
          },
        },
        // …and the sprint-free retry returns the floor / My-Issues rows.
        { body: makeIssueQueryResponse([ISSUE]) },
      ]);
      const query = IssueListQuerySchema.parse({ default_view: true });
      const res = await listIssues({
        adapter: makeAdapter(),
        vault: "reef-acme",
        query,
        actor: actor ?? undefined,
      });
      expect(res.issues).toHaveLength(1);
      expect(calls).toHaveLength(2);
      // The retry carries no reef_sprints reference but keeps the My-Issues fold.
      const retrySql = sqlRequestBody(calls[1]).sql;
      expect(retrySql).not.toContain("reef_sprints");
      const actorEq = `"assigned_to" = $4`;
      const hasMine = `EXISTS (SELECT 1 FROM reef_issues WHERE ${FLOOR} AND ${actorEq})`;
      expect(retrySql).toBe(
        `SELECT * FROM reef_issues WHERE ${actor ? `${FLOOR} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND TRUE))` : FLOOR}`,
      );
      expect(sqlRequestBody(calls[0]).params).toEqual([
        "todo",
        "in_progress",
        "in_review",
        "active",
        ...(actor ? [actor] : []),
      ]);
      expect(sqlRequestBody(calls[1]).params).toEqual([
        "todo",
        "in_progress",
        "in_review",
        ...(actor ? [actor] : []),
      ]);
    },
  );

  it("returns an empty list for a never-onboarded vault (missing table)", async () => {
    // The folded query and its sprint-free retry both hit the missing reef_issues
    // table, so the view collapses to an empty board.
    const { calls } = setupFetch([
      {
        body: { error: 'relation "vt_reef-acme__reef_issues" does not exist' },
      },
      {
        body: { error: 'relation "vt_reef-acme__reef_issues" does not exist' },
      },
    ]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    const res = await listIssues({
      adapter: makeAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(res.issues).toEqual([]);
    expect(res.next_cursor).toBeNull();
    expect(calls).toHaveLength(2);
  });
});
