import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  buildDefaultViewWhere,
  defaultViewStatusFloor,
  encodeCursor,
} from "../core/shared";
import { listIssues } from "./issues";

mockOpenTelemetry();

const FLOOR = `"archived_at" IS NULL AND "status" IN ('todo', 'in_progress', 'in_review')`;
// The active-sprint pick, folded into the default-view query as a scalar
// subquery (REEF-324) instead of a separate `getActiveSprint` round-trip.
const SPRINT_SUBQ = `(SELECT "id" FROM reef_sprints WHERE "status" = 'active' ORDER BY "start_date" DESC NULLS LAST, "id" DESC LIMIT 1)`;
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

function sqlOf(call: { init: RequestInit | undefined }): string {
  return JSON.parse(String(call.init?.body)).sql as string;
}

describe("buildDefaultViewWhere", () => {
  it("floors to active issues + the active sprint with no actor", () => {
    expect(defaultViewStatusFloor()).toBe(FLOOR);
    expect(buildDefaultViewWhere({ actor: null })).toBe(
      `${FLOOR} AND ${SPRINT_FALLBACK}`,
    );
  });

  it("folds the My-Issues existence test and the sprint fallback into one predicate for an actor", () => {
    const actorEq = `"assigned_to" = 'alice'`;
    const hasMine = `EXISTS (SELECT 1 FROM reef_issues WHERE ${FLOOR} AND ${actorEq})`;
    expect(buildDefaultViewWhere({ actor: "alice" })).toBe(
      `${FLOOR} AND ((${hasMine} AND ${actorEq}) OR (NOT ${hasMine} AND ${SPRINT_FALLBACK}))`,
    );
  });

  it("escapes the actor value (injection-safe)", () => {
    const where = buildDefaultViewWhere({ actor: "a'b" });
    expect(where).toContain(`"assigned_to" = 'a''b'`);
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
    expect(sql).toContain(`"assigned_to" = 'alice'`);
    expect(sql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(sql).toContain(SPRINT_SUBQ);
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
    // never an empty My-Issues set.
    expect(calls).toHaveLength(1);
    const sql = sqlOf(calls[0]);
    expect(sql).toContain("EXISTS (SELECT 1 FROM reef_issues");
    expect(sql).toContain(SPRINT_SUBQ);
    expect(sql).toContain(`"created_at" < '2026-05-02T00:00:00.000Z'`);
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
    expect(sql).toContain(`"status" IN ('done')`);
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("EXISTS");
  });

  it("returns an empty list for a never-onboarded vault (missing table)", async () => {
    const { calls } = setupFetch([
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
    expect(calls).toHaveLength(1);
  });
});
