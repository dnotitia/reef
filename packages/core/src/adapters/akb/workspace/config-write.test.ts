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
    const sqls = calls
      .slice(1)
      .map((call) => JSON.parse(call.init?.body as string).sql as string);
    expect(sqls.some((sql) => sql.includes("ai_scanning_enabled"))).toBe(false);
    expect(sqls[0]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls.at(-2)).toContain(`DELETE FROM ${MONITORED_REPOS_TABLE}`);
    expect(sqls.at(-1)).toContain(`INSERT INTO ${MONITORED_REPOS_TABLE}`);
  });
});
