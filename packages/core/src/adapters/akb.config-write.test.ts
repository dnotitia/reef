import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_ATTACHMENTS_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
  REEF_VIEWS_TABLE,
  SchemaValidationError,
  ensureReefTables,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  setupFetch,
  writeConfig,
} from "./akb.testSupport";

// writeConfig statement order (per reef_settings key, then monitored_repos):
//   DELETE project_prefix, INSERT project_prefix,
//   DELETE authoring_language, [INSERT authoring_language when set],
//   DELETE stale_hide_completed_days, INSERT stale_hide_completed_days,
//   DELETE stale_hide_canceled_days, INSERT stale_hide_canceled_days,
//   DELETE ai_scanning_enabled, INSERT ai_scanning_enabled,
//   DELETE monitored_repos, [INSERT monitored_repos when non-empty].

describe("writeConfig (tables)", () => {
  it("provisions tables lazily then emits DELETE + INSERT for settings, DELETE only for empty repos", async () => {
    const { calls } = setupFetch([
      // ensureReefTables: all tables already present (no-op create)
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE monitored_repos
    ]);
    const adapter = makeAdapter();
    await writeConfig({
      adapter,
      vault: "reef-sample",
      config: {
        project_prefix: "ACME",
        monitored_repos: [],
        authoring_language: null,
        stale_hide_completed_days: 14,
        stale_hide_canceled_days: 3,
        ai_scanning_enabled: false,
      },
    });
    expect(calls).toHaveLength(11);
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/tables/reef-sample");
    const sqls = calls
      .slice(1)
      .map((c) => JSON.parse(c.init?.body as string).sql as string);
    expect(sqls[0]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[0]).toContain("'project_prefix'");
    expect(sqls[1]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    // updated_at is NOT in the INSERT column list — akb auto-manages it and
    // would reject a user-declared column of the same name on create.
    expect(sqls[1]).toContain("(key, value)");
    expect(sqls[1]).not.toContain("updated_at");
    expect(sqls[1]).toContain(`'"ACME"'::json`);
    // authoring_language unset → DELETE just, no INSERT.
    expect(sqls[2]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[2]).toContain("'authoring_language'");
    expect(sqls[3]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[3]).toContain("'stale_hide_completed_days'");
    expect(sqls[4]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(sqls[4]).toContain("'stale_hide_completed_days'");
    expect(sqls[4]).toContain(`'14'::json`);
    expect(sqls[5]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[5]).toContain("'stale_hide_canceled_days'");
    expect(sqls[6]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(sqls[6]).toContain("'stale_hide_canceled_days'");
    expect(sqls[6]).toContain(`'3'::json`);
    // ai_scanning_enabled is stored as an explicit boolean row.
    expect(sqls[7]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[7]).toContain("'ai_scanning_enabled'");
    expect(sqls[8]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(sqls[8]).toContain("'ai_scanning_enabled'");
    expect(sqls[8]).toContain(`'false'::json`);
    expect(sqls[9]).toBe(`DELETE FROM ${MONITORED_REPOS_TABLE}`);
  });

  it("emits DELETE + INSERT for a configured authoring_language (REEF-136)", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE monitored_repos
    ]);
    const adapter = makeAdapter();
    await writeConfig({
      adapter,
      vault: "reef-sample",
      config: {
        project_prefix: "ACME",
        monitored_repos: [],
        authoring_language: "ko",
        stale_hide_completed_days: 28,
        stale_hide_canceled_days: 7,
        ai_scanning_enabled: true,
      },
    });
    expect(calls).toHaveLength(12);
    const sqls = calls
      .slice(1)
      .map((c) => JSON.parse(c.init?.body as string).sql as string);
    expect(sqls[2]).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(sqls[2]).toContain("'authoring_language'");
    expect(sqls[3]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(sqls[3]).toContain("(key, value)");
    expect(sqls[3]).toContain("'authoring_language'");
    expect(sqls[3]).toContain(`'"ko"'::json`);
    // ai_scanning_enabled enabled → INSERT carries the JSON boolean `true`.
    // (authoring_language is also set here, so its INSERT shifts these by one.)
    expect(sqls[9]).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(sqls[9]).toContain("'ai_scanning_enabled'");
    expect(sqls[9]).toContain(`'true'::json`);
    expect(sqls[10]).toBe(`DELETE FROM ${MONITORED_REPOS_TABLE}`);
  });

  it("creates missing tables on first write (lazy provisioning)", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse([]) },
      { status: 201, body: { name: REEF_SETTINGS_TABLE } },
      { status: 201, body: { name: MONITORED_REPOS_TABLE } },
      { status: 201, body: { name: REEF_ISSUES_TABLE } },
      { status: 201, body: { name: REEF_SPRINTS_TABLE } },
      { status: 201, body: { name: REEF_MILESTONES_TABLE } },
      { status: 201, body: { name: REEF_RELEASES_TABLE } },
      { status: 201, body: { name: REEF_TEMPLATES_TABLE } },
      { status: 201, body: { name: REEF_ACTIVITY_SUGGESTIONS_TABLE } },
      { status: 201, body: { name: REEF_COMMENTS_TABLE } },
      { status: 201, body: { name: REEF_ATTACHMENTS_TABLE } },
      { status: 201, body: { name: REEF_ACTIVITY_TABLE } },
      { status: 201, body: { name: REEF_VIEWS_TABLE } },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE monitored_repos
    ]);
    const adapter = makeAdapter();
    await writeConfig({
      adapter,
      vault: "reef-sample",
      config: {
        project_prefix: "REEF",
        monitored_repos: [],
        authoring_language: null,
        stale_hide_completed_days: 28,
        stale_hide_canceled_days: 7,
        ai_scanning_enabled: false,
      },
    });
    expect(calls).toHaveLength(24);
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/tables/reef-sample");
    const createNames = calls
      .slice(1, 13)
      .map((c) => JSON.parse(c.init?.body as string).name);
    expect(createNames).toEqual(ALL_REEF_TABLES);
  });

  it("emits multi-row INSERT when monitored_repos is non-empty", async () => {
    const { calls } = setupFetch([
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      { body: makeSqlMutationResponse("DELETE 1") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 2") }, // DELETE monitored_repos
      { body: makeSqlMutationResponse("INSERT 0 2") }, // INSERT monitored_repos
    ]);
    const adapter = makeAdapter();
    await writeConfig({
      adapter,
      vault: "reef-sample",
      config: {
        project_prefix: "REEF",
        monitored_repos: [
          { github_id: 1, owner: "octo", name: "cat", description: "kitty" },
          { github_id: 2, owner: "octo", name: "dog" },
        ],
        authoring_language: null,
        stale_hide_completed_days: 28,
        stale_hide_canceled_days: 7,
        ai_scanning_enabled: true,
      },
    });
    expect(calls).toHaveLength(12);
    const insertRepos = JSON.parse(calls[11]?.init?.body as string)
      .sql as string;
    expect(insertRepos).toContain(`INSERT INTO ${MONITORED_REPOS_TABLE}`);
    expect(insertRepos).toContain("(1, 'octo', 'cat', 'kitty')");
    expect(insertRepos).toContain("(2, 'octo', 'dog', NULL)");
  });

  it("escapes single quotes in description without breaking out of the literal", async () => {
    const { calls } = setupFetch([
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE monitored_repos
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT monitored_repos
    ]);
    const adapter = makeAdapter();
    await writeConfig({
      adapter,
      vault: "reef-sample",
      config: {
        project_prefix: "REEF",
        monitored_repos: [
          {
            github_id: 42,
            owner: "octo",
            name: "cat",
            description: "'; DROP TABLE reef_settings; --",
          },
        ],
        authoring_language: null,
        stale_hide_completed_days: 28,
        stale_hide_canceled_days: 7,
        ai_scanning_enabled: false,
      },
    });
    const insertRepos = JSON.parse(calls[11]?.init?.body as string)
      .sql as string;
    expect(insertRepos).toContain(
      "(42, 'octo', 'cat', '''; DROP TABLE reef_settings; --')",
    );
    expect(insertRepos.trimEnd().endsWith(")")).toBe(true);
  });

  it("rejects NUL bytes in monitored_repo description", async () => {
    setupFetch([
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE project_prefix
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT project_prefix
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE authoring_language
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_completed_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_completed_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE stale_hide_canceled_days
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT stale_hide_canceled_days
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE ai_scanning_enabled
      { body: makeSqlMutationResponse("INSERT 0 1") }, // INSERT ai_scanning_enabled
      { body: makeSqlMutationResponse("DELETE 0") }, // DELETE monitored_repos
    ]);
    const adapter = makeAdapter();
    await expect(
      writeConfig({
        adapter,
        vault: "reef-sample",
        config: {
          project_prefix: "REEF",
          monitored_repos: [
            {
              github_id: 1,
              owner: "octo",
              name: "cat",
              description: "bad\0value",
            },
          ],
          authoring_language: null,
          stale_hide_completed_days: 28,
          stale_hide_canceled_days: 7,
          ai_scanning_enabled: false,
        },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });
});
