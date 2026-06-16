import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  AuthError,
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
  ensureReefTables,
  makeAdapter,
  makeListTablesResponse,
  setupFetch,
} from "./akb.testSupport";

describe("ensureReefTables", () => {
  it("creates all reef tables when none exist (akb { kind: 'table', items: [] } shape)", async () => {
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
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(9);
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/tables/reef-sample");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
    const firstCreate = JSON.parse(calls[1]?.init?.body as string);
    expect(firstCreate.name).toBe(REEF_SETTINGS_TABLE);
    // updated_at is NOT in the column list — akb auto-injects it and would
    // reject a user-defined column of the same name on create.
    expect(firstCreate.columns).toEqual([
      { name: "key", type: "text", required: true },
      { name: "value", type: "json", required: true },
    ]);
    const secondCreate = JSON.parse(calls[2]?.init?.body as string);
    expect(secondCreate.name).toBe(MONITORED_REPOS_TABLE);
    expect(secondCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "github_id", type: "number" }),
      ]),
    );
    const thirdCreate = JSON.parse(calls[3]?.init?.body as string);
    expect(thirdCreate.name).toBe(REEF_ISSUES_TABLE);
    expect(thirdCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "document_uri", type: "text" }),
        expect.objectContaining({
          name: "issue_type",
          type: "text",
          required: true,
        }),
        expect.objectContaining({ name: "parent_id", type: "text" }),
        expect.objectContaining({ name: "requester", type: "text" }),
        expect.objectContaining({ name: "reporter", type: "text" }),
        expect.objectContaining({ name: "start_date", type: "text" }),
        expect.objectContaining({ name: "due_date", type: "text" }),
        expect.objectContaining({ name: "milestone_id", type: "text" }),
        expect.objectContaining({ name: "sprint_id", type: "text" }),
        expect.objectContaining({ name: "release_id", type: "text" }),
        expect.objectContaining({ name: "estimate_points", type: "number" }),
        expect.objectContaining({ name: "severity", type: "text" }),
        expect.objectContaining({ name: "rank", type: "number" }),
        expect.objectContaining({ name: "closed_at", type: "text" }),
        expect.objectContaining({ name: "closed_reason", type: "text" }),
        expect.objectContaining({ name: "related_to", type: "json" }),
        expect.objectContaining({ name: "status", type: "text" }),
        expect.objectContaining({ name: "meta", type: "json" }),
      ]),
    );
    // akb auto-injects created_at/updated_at — declaring them would fail.
    const issuesColumnNames = (
      thirdCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(issuesColumnNames).not.toContain("created_at");
    expect(issuesColumnNames).not.toContain("updated_at");
    const fourthCreate = JSON.parse(calls[4]?.init?.body as string);
    expect(fourthCreate.name).toBe(REEF_SPRINTS_TABLE);
    expect(fourthCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", type: "text", required: true }),
        expect.objectContaining({
          name: "status",
          type: "text",
          required: true,
        }),
        expect.objectContaining({ name: "start_date", type: "text" }),
        expect.objectContaining({ name: "end_date", type: "text" }),
        expect.objectContaining({ name: "capacity_points", type: "number" }),
        expect.objectContaining({ name: "meta", type: "json" }),
      ]),
    );
    const sprintColumnNames = (
      fourthCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(sprintColumnNames).not.toContain("created_at");
    expect(sprintColumnNames).not.toContain("updated_at");
    // reef does not declares `id`; akb auto-injects the uuid primary key.
    expect(sprintColumnNames).not.toContain("id");

    const fifthCreate = JSON.parse(calls[5]?.init?.body as string);
    expect(fifthCreate.name).toBe(REEF_MILESTONES_TABLE);
    expect(fifthCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", type: "text", required: true }),
        expect.objectContaining({
          name: "status",
          type: "text",
          required: true,
        }),
        expect.objectContaining({ name: "target_date", type: "text" }),
        expect.objectContaining({ name: "description", type: "text" }),
        expect.objectContaining({ name: "meta", type: "json" }),
      ]),
    );

    const sixthCreate = JSON.parse(calls[6]?.init?.body as string);
    expect(sixthCreate.name).toBe(REEF_RELEASES_TABLE);
    expect(sixthCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", type: "text", required: true }),
        expect.objectContaining({
          name: "status",
          type: "text",
          required: true,
        }),
        expect.objectContaining({ name: "target_date", type: "text" }),
        expect.objectContaining({ name: "released_at", type: "text" }),
        expect.objectContaining({ name: "notes", type: "text" }),
        expect.objectContaining({ name: "meta", type: "json" }),
      ]),
    );

    const seventhCreate = JSON.parse(calls[7]?.init?.body as string);
    expect(seventhCreate.name).toBe(REEF_TEMPLATES_TABLE);
    expect(seventhCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", type: "text", required: true }),
        expect.objectContaining({ name: "body", type: "text" }),
        expect.objectContaining({ name: "default_labels", type: "json" }),
      ]),
    );
    const templatesColumnNames = (
      seventhCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(templatesColumnNames).not.toContain("created_at");
    expect(templatesColumnNames).not.toContain("updated_at");

    const eighthCreate = JSON.parse(calls[8]?.init?.body as string);
    expect(eighthCreate.name).toBe(REEF_ACTIVITY_SUGGESTIONS_TABLE);
    expect(eighthCreate.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "document_uri", type: "text" }),
        expect.objectContaining({ name: "suggestion_id", type: "text" }),
        expect.objectContaining({ name: "fingerprint", type: "text" }),
        expect.objectContaining({ name: "meta", type: "json" }),
      ]),
    );
  });

  it("creates only the missing tables when some already exist", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse([REEF_SETTINGS_TABLE]) },
      { status: 201, body: { name: MONITORED_REPOS_TABLE } },
      { status: 201, body: { name: REEF_ISSUES_TABLE } },
      { status: 201, body: { name: REEF_SPRINTS_TABLE } },
      { status: 201, body: { name: REEF_MILESTONES_TABLE } },
      { status: 201, body: { name: REEF_RELEASES_TABLE } },
      { status: 201, body: { name: REEF_TEMPLATES_TABLE } },
      { status: 201, body: { name: REEF_ACTIVITY_SUGGESTIONS_TABLE } },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(8);
    const createdNames = calls
      .slice(1)
      .map((c) => JSON.parse(c.init?.body as string).name);
    expect(createdNames).toEqual([
      MONITORED_REPOS_TABLE,
      REEF_ISSUES_TABLE,
      REEF_SPRINTS_TABLE,
      REEF_MILESTONES_TABLE,
      REEF_RELEASES_TABLE,
      REEF_TEMPLATES_TABLE,
      REEF_ACTIVITY_SUGGESTIONS_TABLE,
    ]);
  });

  it("is a no-op when all tables already exist", async () => {
    const { calls } = setupFetch([
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(1);
  });

  it("accepts the older { tables: [...] } shape as a parser fallback", async () => {
    const { calls } = setupFetch([
      {
        body: {
          tables: [...ALL_REEF_TABLES.map((name) => ({ name }))],
        },
      },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(1);
  });

  it("propagates auth errors from listTables", async () => {
    setupFetch([{ status: 401, body: { detail: "unauthorized" } }]);
    const adapter = makeAdapter();
    await expect(
      ensureReefTables({ adapter, vault: "reef-sample" }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

// ── Planning metadata ───────────────────────────────────────────────────────
