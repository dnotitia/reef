import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_TABLE,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  setupFetch,
  writeConfig,
} from "../core/akb.testSupport";

describe("writeConfig", () => {
  it("writes retained settings and monitored repos without scan state", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    await writeConfig({
      adapter: makeAdapter(),
      vault: "reef-sample",
      config: {
        project_prefix: "ACME",
        monitored_repos: [{ github_id: 1, owner: "acme", name: "api" }],
        authoring_language: "ko",
        stale_hide_completed_days: 14,
        stale_hide_canceled_days: 3,
      },
    });
    const bodies = calls
      .slice(1)
      .map((call) => JSON.parse(call.init?.body as string));
    const sqls = bodies.map((body) => body.sql as string);
    expect(sqls.some((sql) => sql.includes("ai_scanning_enabled"))).toBe(false);
    expect(sqls[0]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls.at(-2)).toContain(`DELETE FROM ${MONITORED_REPOS_TABLE}`);
    expect(sqls.at(-1)).toContain(`INSERT INTO ${MONITORED_REPOS_TABLE}`);
    expect(bodies[0].params).toEqual(["project_prefix"]);
    expect(bodies[1].sql).toContain("VALUES ($1, $2::json)");
    expect(bodies[1].params).toEqual([
      "project_prefix",
      JSON.stringify("ACME"),
    ]);
    expect(bodies[3].params).toEqual([
      "authoring_language",
      JSON.stringify("ko"),
    ]);
    expect(bodies[5].params).toEqual([
      "stale_hide_completed_days",
      JSON.stringify(14),
    ]);
    expect(bodies[7].params).toEqual([
      "stale_hide_canceled_days",
      JSON.stringify(3),
    ]);
    expect(bodies[9].params).toEqual([1, "acme", "api", null]);
  });
});
