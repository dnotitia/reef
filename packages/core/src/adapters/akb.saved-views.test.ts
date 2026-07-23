import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  ConflictError,
  REEF_VIEWS_TABLE,
  createSavedIssueView,
  listSavedIssueViews,
  makeAdapter,
  makeListTablesResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeError400Response,
  setupFetch,
  updateSavedIssueView,
} from "./akb.testSupport";

const SAVED_VIEW_COLUMNS = [
  "id",
  "name",
  "name_key",
  "owner",
  "payload",
  "created_at",
  "updated_at",
  "created_by",
];

const SAVED_VIEW_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "My Issues",
  name_key: "my issues",
  owner: "alice",
  payload: { version: 1, query: { assignee: ["alice"], view: ["list"] } },
  created_at: "2026-07-23T00:00:00.000Z",
  updated_at: "2026-07-23T00:00:00.000Z",
  created_by: "alice",
};

describe("saved issue views", () => {
  it("lists valid rows in deterministic name order SQL", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([SAVED_VIEW_ROW], SAVED_VIEW_COLUMNS) },
    ]);
    const views = await listSavedIssueViews({
      adapter: makeAdapter(),
      vault: "reef-sample",
    });
    expect(views[0]).toMatchObject({
      id: SAVED_VIEW_ROW.id,
      name: SAVED_VIEW_ROW.name,
      name_key: SAVED_VIEW_ROW.name_key,
      owner: SAVED_VIEW_ROW.owner,
      payload: SAVED_VIEW_ROW.payload,
    });
    expect(JSON.parse(calls[0]?.init?.body as string).sql).toContain(
      `FROM ${REEF_VIEWS_TABLE} ORDER BY name_key ASC, id ASC`,
    );
  });

  it("drops only malformed stored query members instead of dropping the row", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            {
              ...SAVED_VIEW_ROW,
              payload: {
                version: 1,
                query: {
                  status: ["todo", 42],
                  due: "not-an-array",
                  unknown: ["kept-for-codec"],
                },
              },
            },
          ],
          SAVED_VIEW_COLUMNS,
        ),
      },
    ]);
    const views = await listSavedIssueViews({
      adapter: makeAdapter(),
      vault: "reef-sample",
    });
    expect(views[0]?.payload.query).toEqual({
      status: ["todo"],
      unknown: ["kept-for-codec"],
    });
  });

  it("degrades only a missing views table to an empty list", async () => {
    setupFetch([makeSqlRuntimeError400Response(REEF_VIEWS_TABLE)]);
    await expect(
      listSavedIssueViews({
        adapter: makeAdapter(),
        vault: "reef-sample",
      }),
    ).resolves.toEqual([]);
  });

  it("provisions before create, normalizes the name key, and escapes SQL", async () => {
    const row = {
      ...SAVED_VIEW_ROW,
      name: "ＰＲ's",
      name_key: "pr's",
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([row], SAVED_VIEW_COLUMNS) },
    ]);
    const result = await createSavedIssueView({
      adapter: makeAdapter(),
      vault: "reef-sample",
      owner: "alice",
      view: {
        name: "  ＰＲ's  ",
        payload: { version: 1, query: { status: ["todo"] } },
      },
    });
    expect(result.view).toMatchObject({
      id: row.id,
      name: row.name,
      name_key: row.name_key,
      owner: row.owner,
      payload: row.payload,
    });
    const sql = JSON.parse(calls[1]?.init?.body as string).sql as string;
    expect(sql).toContain(`INSERT INTO ${REEF_VIEWS_TABLE}`);
    expect(sql).toContain("'ＰＲ''s'");
    expect(sql).toContain("'pr''s'");
    expect(sql).toContain("RETURNING *");
  });

  it("propagates an AKB unique violation as ConflictError", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        status: 409,
        body: {
          detail: {
            code: "unique_violation",
            message: "duplicate key violates unique constraint",
          },
        },
      },
    ]);
    await expect(
      createSavedIssueView({
        adapter: makeAdapter(),
        vault: "reef-sample",
        owner: "alice",
        view: {
          name: "MY ISSUES",
          payload: { version: 1, query: { status: ["todo"] } },
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates by UUID and rejects a deleted row", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], SAVED_VIEW_COLUMNS) },
    ]);
    await expect(
      updateSavedIssueView({
        adapter: makeAdapter(),
        vault: "reef-sample",
        id: SAVED_VIEW_ROW.id,
        patch: { name: "Renamed" },
      }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    const sql = JSON.parse(calls[1]?.init?.body as string).sql as string;
    expect(sql).toContain(`WHERE id = '${SAVED_VIEW_ROW.id}' RETURNING *`);
  });
});
