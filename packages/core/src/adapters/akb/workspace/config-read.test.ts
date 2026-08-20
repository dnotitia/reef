import { describe, expect, it } from "vitest";
import {
  MONITORED_REPOS_TABLE,
  REEF_SETTINGS_TABLE,
  makeAdapter,
  makeSqlQueryResponse,
  readAuthoringLanguage,
  readConfig,
  setupFetch,
} from "../core/akb.testSupport";

describe("readConfig", () => {
  it("reads retained workspace settings and monitored repositories", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            { key: "project_prefix", value: '"ACME"' },
            { key: "authoring_language", value: '"ko"' },
            { key: "stale_hide_completed_days", value: "14" },
            { key: "stale_hide_canceled_days", value: "3" },
          ],
          ["key", "value"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [{ github_id: "123", owner: "acme", name: "api", description: null }],
          ["github_id", "owner", "name", "description"],
        ),
      },
    ]);
    const result = await readConfig({
      adapter: makeAdapter(),
      vault: "reef-sample",
    });
    expect(result).toEqual({
      exists: true,
      config: {
        project_prefix: "ACME",
        authoring_language: "ko",
        stale_hide_completed_days: 14,
        stale_hide_canceled_days: 3,
        monitored_repos: [{ github_id: 123, owner: "acme", name: "api" }],
      },
    });
    const settingsSql = JSON.parse(calls[0]?.init?.body as string)
      .sql as string;
    expect(settingsSql).toContain(`FROM ${REEF_SETTINGS_TABLE}`);
    expect(settingsSql).not.toContain("ai_scanning_enabled");
    const reposSql = JSON.parse(calls[1]?.init?.body as string).sql as string;
    expect(reposSql).toContain(`FROM ${MONITORED_REPOS_TABLE}`);
  });

  it("returns the default config when the settings table is missing", async () => {
    setupFetch([
      {
        body: { error: 'relation "reef_settings" does not exist' },
      },
      {
        body: { error: 'relation "monitored_repos" does not exist' },
      },
    ]);
    const result = await readConfig({
      adapter: makeAdapter(),
      vault: "reef-sample",
    });
    expect(result.exists).toBe(false);
    expect(result.config.monitored_repos).toEqual([]);
    expect(result.config).not.toHaveProperty("ai_scanning_enabled");
  });
});

describe("readAuthoringLanguage", () => {
  it("reads the retained authoring language key", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ key: "authoring_language", value: '"ja"' }],
          ["key", "value"],
        ),
      },
    ]);
    await expect(
      readAuthoringLanguage({ adapter: makeAdapter(), vault: "reef-sample" }),
    ).resolves.toBe("ja");
  });
});
