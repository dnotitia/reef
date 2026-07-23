import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  ConflictError,
  ISSUE_ROW_COLUMNS,
  MILESTONE_ROW_COLUMNS,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SPRINTS_TABLE,
  RELEASE_ROW_COLUMNS,
  SPRINT_ROW_COLUMNS,
  createMilestone,
  createSprint,
  deleteMilestone,
  deleteRelease,
  deleteSprint,
  listPlanningCatalog,
  makeAdapter,
  makeIssueRow,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  readPlanningCreateClaim,
  setupFetch,
  updateRelease,
} from "./akb.testSupport";

describe("planning metadata", () => {
  it("lists sprints, milestones, and releases from reef planning tables", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Sprint 12",
              status: "active",
              start_date: "2026-05-01",
              end_date: "2026-05-14",
              goal: "Stabilize onboarding",
              capacity_points: 40,
              meta: {},
            },
          ],
          SPRINT_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "MVP beta",
              status: "open",
              target_date: "2026-06-01",
              description: "Beta readiness",
              meta: {},
            },
          ],
          MILESTONE_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "v1.3.0",
              status: "planned",
              target_date: "2026-06-10",
              released_at: null,
              notes: "June release",
              meta: {},
            },
          ],
          RELEASE_ROW_COLUMNS,
        ),
      },
    ]);
    const adapter = makeAdapter();
    const catalog = await listPlanningCatalog({
      adapter,
      vault: "reef-sample",
    });
    expect(catalog.sprints[0]?.name).toBe("Sprint 12");
    expect(catalog.milestones[0]?.name).toBe("MVP beta");
    expect(catalog.releases[0]?.name).toBe("v1.3.0");
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0]?.init?.body as string).sql).toContain(
      `FROM ${REEF_SPRINTS_TABLE}`,
    );
  });

  it("inserts a sprint atomically and returns it with the akb-assigned uuid", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], SPRINT_ROW_COLUMNS) }, // unique-name check
      {
        body: makeSqlQueryResponse(
          [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "Sprint 12",
              status: "planned",
              start_date: "2026-05-01",
              end_date: "2026-05-14",
              goal: "Stabilize onboarding",
              capacity_points: 40,
              meta: {},
            },
          ],
          SPRINT_ROW_COLUMNS,
        ),
      }, // WITH ins AS (INSERT ... RETURNING *) SELECT * FROM ins
    ]);
    const adapter = makeAdapter();
    const sprint = await createSprint({
      adapter,
      vault: "reef-sample",
      item: {
        name: "Sprint 12",
        status: "planned",
        start_date: "2026-05-01",
        end_date: "2026-05-14",
        goal: "Stabilize onboarding",
        capacity_points: 40,
      },
    });
    // akb assigns the uuid id and returns the row in one statement via the
    // data-modifying CTE — no separate read-back to race.
    expect(sprint.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const insertSql = JSON.parse(calls[2]?.init?.body as string).sql;
    expect(insertSql).toMatch(/^WITH ins AS \(INSERT INTO /);
    expect(insertSql).toContain("RETURNING *");
    expect(insertSql).toContain("'Sprint 12'");
    expect(insertSql).not.toContain('"id"'); // id is does not written
  });

  it("recovers a planning create only through its durable idempotency claim", async () => {
    const claimedRow = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Claimed Sprint",
      status: "planned",
      start_date: null,
      end_date: null,
      goal: "",
      capacity_points: null,
      meta: { create_idempotency_key: "sprint:cloud-1:42" },
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([claimedRow], SPRINT_ROW_COLUMNS) },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([claimedRow], SPRINT_ROW_COLUMNS) },
      { body: makeSqlQueryResponse([claimedRow], SPRINT_ROW_COLUMNS) },
    ]);
    const adapter = makeAdapter();
    const input = {
      adapter,
      vault: "reef-sample",
      item: {
        name: "Claimed Sprint",
        status: "planned" as const,
        start_date: null,
        end_date: null,
        goal: "",
        capacity_points: null,
      },
      idempotencyKey: "sprint:cloud-1:42",
    };
    await expect(createSprint(input)).resolves.toMatchObject({
      id: claimedRow.id,
    });
    await expect(createSprint(input)).resolves.toMatchObject({
      id: claimedRow.id,
    });
    await expect(
      readPlanningCreateClaim({
        adapter,
        vault: "reef-sample",
        kind: "sprint",
        idempotencyKey: "sprint:cloud-1:42",
      }),
    ).resolves.toMatchObject({ id: claimedRow.id });
    const insertSql = JSON.parse(calls[1]?.init?.body as string).sql;
    expect(insertSql).toContain("pg_advisory_xact_lock");
    expect(insertSql).toContain("claim_lock AS MATERIALIZED");
    expect(insertSql).toContain("name_conflict AS MATERIALIZED");
    expect(insertSql).toContain("create_idempotency_key");
    expect(insertSql).toContain("sprint:cloud-1:42");
  });

  it("rejects an invalid sprint before inserting", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
    ]);
    const adapter = makeAdapter();
    await expect(
      createSprint({
        adapter,
        vault: "reef-sample",
        item: {
          name: "Backwards sprint",
          status: "planned",
          start_date: "2026-05-14",
          end_date: "2026-05-01", // end before start — invalid
          goal: "",
        },
      }),
    ).rejects.toThrow();
    // just ensureReefTables (listTables) ran; the item is validated before any
    // INSERT, so no invalid row is written and read-back is does not reached.
    expect(calls).toHaveLength(1);
  });

  it("blocks duplicate planning names case-insensitively", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "mvp beta",
              status: "open",
              target_date: null,
              description: "",
              meta: {},
            },
          ],
          MILESTONE_ROW_COLUMNS,
        ),
      },
    ]);
    const adapter = makeAdapter();
    await expect(
      createMilestone({
        adapter,
        vault: "reef-sample",
        item: {
          name: "MVP Beta",
          status: "open",
          target_date: null,
          description: "",
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates a release row after checking id and name uniqueness", async () => {
    const release = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "v1.3.0",
      status: "in_progress" as const,
      target_date: "2026-06-10",
      released_at: null,
      notes: "Release candidate is building",
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], RELEASE_ROW_COLUMNS) },
      { body: makeSqlQueryResponse([release], RELEASE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("UPDATE 1") },
    ]);
    const adapter = makeAdapter();
    await expect(
      updateRelease({
        adapter,
        vault: "reef-sample",
        id: release.id,
        item: release,
      }),
    ).resolves.toMatchObject({ status: "in_progress" });
    const updateSql = JSON.parse(calls[3]?.init?.body as string).sql;
    expect(updateSql).toContain(`UPDATE ${REEF_RELEASES_TABLE} SET`);
    expect(updateSql).toContain(`WHERE id = '${release.id}'`);
  });

  it("blocks deleting planning rows referenced by issues", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([makeIssueRow()], ISSUE_ROW_COLUMNS) },
    ]);
    const adapter = makeAdapter();
    await expect(
      deleteSprint({
        adapter,
        vault: "reef-sample",
        id: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.init?.body as string).sql).toContain(
      `"sprint_id" = '22222222-2222-4222-8222-222222222222'`,
    );
  });

  it("deletes unreferenced milestone and release rows", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([], ISSUE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("DELETE 1") },
      { body: makeSqlQueryResponse([], ISSUE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("DELETE 1") },
    ]);
    const adapter = makeAdapter();
    await deleteMilestone({
      adapter,
      vault: "reef-sample",
      id: "22222222-2222-4222-8222-222222222222",
    });
    await deleteRelease({
      adapter,
      vault: "reef-sample",
      id: "33333333-3333-4333-8333-333333333333",
    });
    expect(JSON.parse(calls[1]?.init?.body as string).sql).toContain(
      `DELETE FROM ${REEF_MILESTONES_TABLE}`,
    );
    expect(JSON.parse(calls[3]?.init?.body as string).sql).toContain(
      `DELETE FROM ${REEF_RELEASES_TABLE}`,
    );
  });
});

// ── Templates ────────────────────────────────────────────────────────────────
