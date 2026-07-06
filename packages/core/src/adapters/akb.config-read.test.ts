import { describe, expect, it } from "vitest";
import {
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_TABLE,
  makeAdapter,
  makeSqlQueryResponse,
  makeSqlRuntimeError400Response,
  makeSqlRuntimeErrorResponse,
  readAuthoringLanguage,
  readConfig,
  setupFetch,
} from "./akb.testSupport";

describe("readConfig (tables)", () => {
  it("returns DEFAULT_CONFIG when reef tables do not exist (HTTP 200 + error envelope)", async () => {
    // Both SELECTs fan out in parallel and both fail on a raw vault — supply
    // a runtime-error response for each so the Promise.all collects them.
    setupFetch([
      makeSqlRuntimeErrorResponse(REEF_SETTINGS_TABLE),
      makeSqlRuntimeErrorResponse(MONITORED_REPOS_TABLE),
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.project_prefix).toBe("REEF");
    expect(result.config.monitored_repos).toEqual([]);
    expect(result.config.authoring_language).toBeNull();
    expect(result.config.stale_hide_completed_days).toBe(28);
    expect(result.config.stale_hide_canceled_days).toBe(7);
    expect(result.exists).toBe(false);
  });

  it("returns DEFAULT_CONFIG when reef tables do not exist (HTTP 400 + detail envelope, akb REST — REEF-363)", async () => {
    // akb's newer REST surface returns a missing-relation error as HTTP 400
    // with an object `detail: { message, code }` instead of the older HTTP
    // 200 `{ error }` body. The degrade to DEFAULT_CONFIG should survive that
    // change, so `isMissingTableError` still has to recognize the new shape.
    setupFetch([
      makeSqlRuntimeError400Response(REEF_SETTINGS_TABLE),
      makeSqlRuntimeError400Response(MONITORED_REPOS_TABLE),
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.project_prefix).toBe("REEF");
    expect(result.config.monitored_repos).toEqual([]);
    expect(result.exists).toBe(false);
  });

  it("decodes a JSON-encoded scalar value from the json column", async () => {
    // akb's SQL endpoint returns json/JSONB scalars as their JSON text form,
    // so a stored "ACME" comes back as the 6-char string '"ACME"'.
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: '"ACME"' }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.exists).toBe(true);
    expect(result.config.project_prefix).toBe("ACME");
  });

  it("accepts an already-decoded scalar (defensive against backend changes)", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: "ACME" }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.exists).toBe(true);
    expect(result.config.project_prefix).toBe("ACME");
  });

  it("returns DEFAULT_CONFIG when settings is empty (no project_prefix row)", async () => {
    setupFetch([
      { body: makeSqlQueryResponse([], ["key", "value"]) },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.exists).toBe(false);
    expect(result.config.project_prefix).toBe("REEF");
  });

  it("reads the authoring_language row alongside project_prefix (REEF-136)", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "authoring_language", value: '"ko"' },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.exists).toBe(true);
    expect(result.config.authoring_language).toBe("ko");
  });

  it("leaves authoring_language null when its row is absent", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: '"ACME"' }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.authoring_language).toBeNull();
  });

  it("reads resolved auto-hide windows from reef_settings (REEF-278)", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "stale_hide_completed_days", value: "14" },
            { key: "stale_hide_canceled_days", value: "3" },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.stale_hide_completed_days).toBe(14);
    expect(result.config.stale_hide_canceled_days).toBe(3);
  });

  it("falls back to default resolved auto-hide windows for missing or invalid stored values", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "stale_hide_completed_days", value: "-1" },
            { key: "stale_hide_canceled_days", value: '"soon"' },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.stale_hide_completed_days).toBe(28);
    expect(result.config.stale_hide_canceled_days).toBe(7);
  });

  it("degrades an unknown/stale authoring_language code to null", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "authoring_language", value: '"klingon"' },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.authoring_language).toBeNull();
  });

  it("assembles Config from settings + monitored_repos rows", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: '"ACME"' }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              github_id: 123456,
              owner: "acme",
              name: "api",
              description: "monorepo",
            },
            {
              github_id: 789012,
              owner: "acme",
              name: "web",
              description: null,
            },
          ],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.exists).toBe(true);
    expect(result.config.project_prefix).toBe("ACME");
    expect(result.config.monitored_repos).toEqual([
      {
        github_id: 123456,
        owner: "acme",
        name: "api",
        description: "monorepo",
      },
      { github_id: 789012, owner: "acme", name: "web" },
    ]);
  });

  it("uses the /api/v1/tables/{vault}/sql endpoint", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: '"ACME"' }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    await readConfig({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe("https://akb.test/api/v1/tables/reef-sample/sql");
      expect(call.init?.method).toBe("POST");
    }
    const firstSql = JSON.parse(calls[0]?.init?.body as string).sql as string;
    expect(firstSql).toContain(`FROM ${REEF_SETTINGS_TABLE}`);
    expect(firstSql).toContain("'project_prefix'");
    expect(firstSql).toContain("'authoring_language'");
    expect(firstSql).toContain("'stale_hide_completed_days'");
    expect(firstSql).toContain("'stale_hide_canceled_days'");
    expect(firstSql).toContain("'ai_scanning_enabled'");
    const secondSql = JSON.parse(calls[1]?.init?.body as string).sql as string;
    expect(secondSql).toContain(`FROM ${MONITORED_REPOS_TABLE}`);
  });

  it("reads the ai_scanning_enabled switch and defaults it to false (REEF-313)", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "ai_scanning_enabled", value: "true" },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.ai_scanning_enabled).toBe(true);
  });

  it("leaves ai_scanning_enabled false when its row is absent (REEF-313)", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "project_prefix", value: '"ACME"' }],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readConfig({ adapter, vault: "reef-sample" });
    expect(result.config.ai_scanning_enabled).toBe(false);
  });
});

describe("readAuthoringLanguage (REEF-136)", () => {
  it("returns the configured language code", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "authoring_language", value: '"ja"' }],
          ["key", "value"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    const language = await readAuthoringLanguage({
      adapter,
      vault: "reef-sample",
    });
    expect(language).toBe("ja");
  });

  it("returns null when the row is absent", async () => {
    setupFetch([{ body: makeSqlQueryResponse([], ["key", "value"]) }]);
    const adapter = makeAdapter();
    const language = await readAuthoringLanguage({
      adapter,
      vault: "reef-sample",
    });
    expect(language).toBeNull();
  });

  it("returns null (never throws) when the settings table is missing", async () => {
    setupFetch([makeSqlRuntimeErrorResponse(REEF_SETTINGS_TABLE)]);
    const adapter = makeAdapter();
    const language = await readAuthoringLanguage({
      adapter,
      vault: "reef-sample",
    });
    expect(language).toBeNull();
  });

  it("queries only the authoring_language key (single lean read)", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "authoring_language", value: '"ko"' }],
          ["key", "value"],
        ),
      },
    ]);
    const adapter = makeAdapter();
    await readAuthoringLanguage({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(1);
    const sql = JSON.parse(calls[0]?.init?.body as string).sql as string;
    expect(sql).toContain(`FROM ${REEF_SETTINGS_TABLE}`);
    expect(sql).toContain("'authoring_language'");
    expect(sql).not.toContain("monitored_repos");
  });
});
