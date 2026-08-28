import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import {
  buildDefaultViewWhere,
  defaultViewStatusFloor,
  encodeCursor,
} from "../core/shared";
import { SqlParameterBuilder } from "../core/sql";
import { listIssues } from "./issues";

mockOpenTelemetry();

const FLOOR = `"archived_at" IS NULL AND "status" IN ($1, $2, $3)`;
// The active-sprint pick, folded into the default-view query as a scalar
// subquery (REEF-324) instead of a separate `getActiveSprint` round-trip.
const SPRINT_SUBQ = `(SELECT "id" FROM reef_sprints WHERE "status" = $4 ORDER BY "start_date" DESC NULLS LAST, "id" DESC LIMIT 1)`;
const SPRINT_FALLBACK = `(${SPRINT_SUBQ} IS NULL OR "sprint_id" = ${SPRINT_SUBQ})`;

function viewWhere(options: {
  actor: string | null;
  withActiveSprint?: boolean;
}) {
  const params = new SqlParameterBuilder();
  return {
    sql: buildDefaultViewWhere(options, params),
    params: [...params.params],
  };
}

function statusFloor() {
  const params = new SqlParameterBuilder();
  return {
    sql: defaultViewStatusFloor(params),
    params: [...params.params],
  };
}

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

function sqlOf(call: { init: RequestInit | undefined }): string {
  return JSON.parse(String(call.init?.body)).sql as string;
}

function paramsOf(call: { init: RequestInit | undefined }): unknown[] {
  return (
    (JSON.parse(String(call.init?.body)).params as unknown[] | undefined) ?? []
  );
}

describe("buildDefaultViewWhere", () => {
  it("floors to active issues + the active sprint with no actor", () => {
    expect(statusFloor().sql).toBe(FLOOR);
    expect(statusFloor().params).toEqual(["todo", "in_progress", "in_review"]);
    expect(viewWhere({ actor: null }).sql).toBe(
      `${FLOOR} AND ${SPRINT_FALLBACK}`,
    );
    expect(viewWhere({ actor: null }).params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
    ]);
  });

  it("folds the My-Issues existence test and the sprint fallback into one predicate for an actor", () => {
    const actorEq = `"assigned_to" = $5`;
    const hasMine = `EXISTS (SELECT 1 FROM reef_issues WHERE ${FLOOR} AND ${actorEq})`;
    expect(viewWhere({ actor: "alice" }).sql).toBe(
      `${FLOOR} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND ${SPRINT_FALLBACK}))`,
    );
    expect(viewWhere({ actor: "alice" }).params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
      "alice",
    ]);
  });

  it("escapes the actor value (injection-safe)", () => {
    const result = viewWhere({ actor: "a'b" });
    expect(result.sql).toContain(`"assigned_to" = $5`);
    expect(result.params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
      "a'b",
    ]);
  });

  it("drops the active-sprint fold (no reef_sprints reference) when withActiveSprint is false", () => {
    const noActor = viewWhere({
      actor: null,
      withActiveSprint: false,
    });
    expect(noActor.sql).toBe(FLOOR);
    expect(noActor.sql).not.toContain("reef_sprints");
    expect(noActor.params).toEqual(["todo", "in_progress", "in_review"]);

    const actorEq = `"assigned_to" = $4`;
    const hasMine = `EXISTS (SELECT 1 FROM reef_issues WHERE ${FLOOR} AND ${actorEq})`;
    const withActor = viewWhere({
      actor: "alice",
      withActiveSprint: false,
    });
    expect(withActor.sql).toBe(
      `${FLOOR} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND TRUE))`,
    );
    expect(withActor.sql).not.toContain("reef_sprints");
    expect(withActor.params).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "alice",
    ]);
  });
});

describe("listIssues default_view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("issues a single combined query for an actor (no sprint / probe round-trips)", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([ISSUE]) }]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    const res = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(res.issues).toHaveLength(1);
    // Folded: the old path cost 3 calls (active sprint + My-Issues probe + list).
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]);
    expect(sql).toContain(`"assigned_to" = $5`);
    expect(sql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(sql).toContain(SPRINT_SUBQ);
    expect(paramsOf(calls[0] ?? { init: undefined })).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
      "alice",
    ]);
  });

  it("floors to the active sprint in one query when no actor is resolved", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]);
    expect(sql).toContain(SPRINT_SUBQ);
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("EXISTS");
    expect(paramsOf(calls[0] ?? { init: undefined })).toEqual([
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
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // The combined default-view scope AND the keyset predicate land in the same
    // statement — page 2 keeps the up-front scope (My-Issues existence test),
    // not an empty My-Issues set.
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]);
    expect(sql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(sql).toContain(SPRINT_SUBQ);
    expect(sql).toContain(`"created_at" < $6`);
    expect(paramsOf(calls[0] ?? { init: undefined })).toEqual([
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
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // The default-view branch is skipped, so the WHERE is the explicit facet and
    // there is no folded sprint/EXISTS subquery.
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]);
    expect(sql).toContain(`"status" IN ($1)`);
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("EXISTS");
    expect(paramsOf(calls[0] ?? { init: undefined })).toEqual(["done"]);
  });

  it("falls back to a sprint-free query when reef_sprints is missing (pre-planning vault)", async () => {
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
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(res.issues).toHaveLength(1);
    expect(calls).toHaveLength(2);
    // The retry carries no reef_sprints reference but keeps the My-Issues fold.
    const retrySql = sqlOf(calls[1]);
    expect(retrySql).not.toContain("reef_sprints");
    expect(retrySql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(retrySql).toContain(`"assigned_to" = $4`);
    expect(paramsOf(calls[0] ?? { init: undefined })).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "active",
      "alice",
    ]);
    expect(paramsOf(calls[1] ?? { init: undefined })).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "alice",
    ]);
  });

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
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(res.issues).toEqual([]);
    expect(res.next_cursor).toBeNull();
    expect(calls).toHaveLength(2);
  });
});
