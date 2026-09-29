import { describe, expect, it } from "vitest";
import { REEF_VAULT_SKILL_VERSION } from "../vaultSkill/version";
import { buildReefVaultSkillDocuments } from "../vaultSkill/documents";
import {
  TEMPLATE_ROW_COLUMNS,
  makeAdapter,
  makeSqlQueryResponse,
  makeTemplateRow,
  setupFetch,
} from "../core/akb.testSupport";
import { initializeReefWorkspace } from "./initializeWorkspace";

describe("initializeReefWorkspace", () => {
  it("leaves existing settings, template edits, and current instructions untouched", async () => {
    const savedTemplate = {
      name: "bug-report",
      label: "Team incident form",
      description: "Custom workflow for this team",
      default_labels: ["incident", "triage"],
      body: "## Customer impact\n\n## Timeline",
    };
    const settings = [{ key: "project_prefix", value: JSON.stringify("ACME") }];
    const repos = [
      { github_id: 42, owner: "acme", name: "service", description: null },
    ];
    const skillDocuments = buildReefVaultSkillDocuments("reef-sample");
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse(settings, ["key", "value"]) },
      { body: makeSqlQueryResponse(repos, ["github_id", "owner", "name"]) },
      {
        body: makeSqlQueryResponse(
          [makeTemplateRow(savedTemplate)],
          TEMPLATE_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              value: JSON.stringify({
                version: REEF_VAULT_SKILL_VERSION,
                synced_at: "2026-09-01T00:00:00.000Z",
              }),
            },
          ],
          ["value"],
        ),
      },
      ...skillDocuments.map((document) => ({
        body: {
          uri: `akb://reef-sample/doc/${document.path}`,
          vault: "reef-sample",
          path: document.path,
          title: document.title,
          type: document.type,
          status: "active",
          summary: document.summary,
          tags: document.tags,
          content: document.content,
        },
      })),
      { body: makeSqlQueryResponse(settings, ["key", "value"]) },
      { body: makeSqlQueryResponse(repos, ["github_id", "owner", "name"]) },
    ]);

    const result = await initializeReefWorkspace({
      adapter: makeAdapter(),
      vault: "reef-sample",
      defaultTemplates: [savedTemplate],
      initialConfig: {
        project_prefix: "REEF",
        monitored_repos: [],
        authoring_language: null,
        stale_hide_completed_days: 30,
        stale_hide_canceled_days: 30,
      },
    });

    expect(result.project_prefix).toBe("ACME");
    expect(result.monitored_repos).toEqual([
      { github_id: 42, owner: "acme", name: "service" },
    ]);
    expect(calls).toHaveLength(12);
    expect(
      calls
        .filter((call) => call.url.includes("/tables/"))
        .map((call) => JSON.parse(String(call.init?.body)).sql as string),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\b(?:INSERT|UPDATE|DELETE)\b/i),
      ]),
    );
  });
});
