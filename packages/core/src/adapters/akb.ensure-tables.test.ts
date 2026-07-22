import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  AuthError,
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_ATTACHMENTS_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_DESIRED_TABLES,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SCHEMA_VERSION,
  REEF_SETTINGS_SCHEMA_VERSION_KEY,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
  ensureReefTables,
  makeAdapter,
  makeListTablesResponse,
  makeSchemaVersionResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  setupFetch,
} from "./akb.testSupport";
import {
  assertNoAkbManagedColumns,
  reconcileWorkspaceSchema,
} from "./akb/core/tables";

function makeDesiredTablesResponse(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    kind: "table",
    vault: "reef-sample",
    items: REEF_DESIRED_TABLES.map((manifest) => ({
      name: manifest.name,
      columns: manifest.columns,
      ...((overrides[manifest.name] as Record<string, unknown> | undefined) ??
        {}),
    })),
  };
}

function makeDesiredTablesResponseExcept(name: string): unknown {
  return {
    kind: "table",
    vault: "reef-sample",
    items: REEF_DESIRED_TABLES.filter((manifest) => manifest.name !== name).map(
      (manifest) => ({
        name: manifest.name,
        columns: manifest.columns,
      }),
    ),
  };
}

function canonicalizeColumns(
  columns: readonly { name: string; type: string; required?: boolean }[],
): Array<{ name: string; type: string; required?: boolean }> {
  return columns.map((column) => ({
    ...column,
    type:
      column.type === "number"
        ? "numeric"
        : column.type === "json"
          ? "jsonb"
          : column.type,
  }));
}

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
      { status: 201, body: { name: REEF_COMMENTS_TABLE } },
      { status: 201, body: { name: REEF_ATTACHMENTS_TABLE } },
      { status: 201, body: { name: REEF_ACTIVITY_TABLE } },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(15);
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
    const ninthCreate = JSON.parse(calls[9]?.init?.body as string);
    expect(ninthCreate.name).toBe(REEF_COMMENTS_TABLE);
    expect(ninthCreate.columns).toEqual([
      { name: "reef_id", type: "text", required: true },
      { name: "body", type: "text", required: true },
      { name: "meta", type: "json" },
    ]);
    const commentsColumnNames = (
      ninthCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(commentsColumnNames).not.toContain("id");
    expect(commentsColumnNames).not.toContain("created_at");
    expect(commentsColumnNames).not.toContain("updated_at");
    expect(commentsColumnNames).not.toContain("created_by");

    const tenthCreate = JSON.parse(calls[10]?.init?.body as string);
    expect(tenthCreate.name).toBe(REEF_ATTACHMENTS_TABLE);
    expect(tenthCreate.columns).toEqual([
      { name: "reef_id", type: "text", required: true },
      { name: "file_uri", type: "text", required: true },
      { name: "filename", type: "text", required: true },
      { name: "mime_type", type: "text", required: true },
      { name: "size_bytes", type: "number", required: true },
      { name: "author", type: "text", required: true },
      { name: "source", type: "text", required: true },
      { name: "inline", type: "boolean" },
      { name: "original_jira_attachment_id", type: "text" },
      { name: "meta", type: "json" },
    ]);
    const attachmentColumnNames = (
      tenthCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(attachmentColumnNames).not.toContain("id");
    expect(attachmentColumnNames).not.toContain("created_at");
    expect(attachmentColumnNames).not.toContain("updated_at");
    expect(attachmentColumnNames).not.toContain("created_by");

    const eleventhCreate = JSON.parse(calls[11]?.init?.body as string);
    expect(eleventhCreate.name).toBe(REEF_ACTIVITY_TABLE);
    expect(eleventhCreate.columns).toEqual([
      { name: "reef_id", type: "text", required: true },
      { name: "event_type", type: "text", required: true },
      { name: "event_key", type: "text", required: true },
      { name: "payload", type: "json" },
      { name: "meta", type: "json" },
    ]);
    const activityColumnNames = (
      eleventhCreate.columns as Array<{ name: string }>
    ).map((c) => c.name);
    expect(activityColumnNames).not.toContain("id");
    expect(activityColumnNames).not.toContain("created_at");
    expect(activityColumnNames).not.toContain("updated_at");
    expect(activityColumnNames).not.toContain("created_by");
  });

  it("never declares AKB-managed columns in a desired table manifest", () => {
    const reservedColumns = ["id", "created_at", "updated_at", "created_by"];

    for (const manifest of REEF_DESIRED_TABLES) {
      const columnNames = manifest.columns.map((column) => column.name);
      for (const reservedColumn of reservedColumns) {
        expect(columnNames, `${manifest.name}.${reservedColumn}`).not.toContain(
          reservedColumn,
        );
      }
    }
  });

  it.each(["id", "created_at", "updated_at", "created_by"])(
    "rejects the AKB-managed %s column before table creation",
    (reservedColumn) => {
      expect(() =>
        assertNoAkbManagedColumns({
          name: "invalid_manifest",
          columns: [{ name: reservedColumn, type: "text" }],
        }),
      ).toThrow(
        `Invalid data: Reef table invalid_manifest AKB-managed columns (${reservedColumn}) could not be validated.`,
      );
    },
  );

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
      { status: 201, body: { name: REEF_COMMENTS_TABLE } },
      { status: 201, body: { name: REEF_ATTACHMENTS_TABLE } },
      { status: 201, body: { name: REEF_ACTIVITY_TABLE } },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(14);
    const createdNames = calls
      .slice(1, 11)
      .map((c) => JSON.parse(c.init?.body as string).name);
    expect(createdNames).toEqual([
      MONITORED_REPOS_TABLE,
      REEF_ISSUES_TABLE,
      REEF_SPRINTS_TABLE,
      REEF_MILESTONES_TABLE,
      REEF_RELEASES_TABLE,
      REEF_TEMPLATES_TABLE,
      REEF_ACTIVITY_SUGGESTIONS_TABLE,
      REEF_COMMENTS_TABLE,
      REEF_ATTACHMENTS_TABLE,
      REEF_ACTIVITY_TABLE,
    ]);
  });

  it("creates and stamps an immutable historical manifest snapshot", async () => {
    const historicalManifest = {
      name: "reef_new_table",
      description: "introduced at schema version 2",
      columns: [{ name: "value", type: "text" as const, required: true }],
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse([REEF_SETTINGS_TABLE]) },
      { status: 201, body: { name: historicalManifest.name } },
      {
        body: {
          kind: "table",
          vault: "reef-sample",
          items: [
            {
              name: REEF_SETTINGS_TABLE,
              columns: REEF_DESIRED_TABLES.find(
                (table) => table.name === REEF_SETTINGS_TABLE,
              )?.columns,
            },
            {
              name: historicalManifest.name,
              columns: historicalManifest.columns,
            },
          ],
        },
      },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await reconcileWorkspaceSchema({
      adapter: makeAdapter(),
      vault: "reef-sample",
      desiredTables: [historicalManifest],
      schemaVersion: 2,
      allowAdditionalColumns: true,
    });

    expect(calls).toHaveLength(5);
    expect(JSON.parse(calls[1]?.init?.body as string)).toMatchObject(
      historicalManifest,
    );
    const insertSql = JSON.parse(calls[4]?.init?.body as string).sql as string;
    expect(insertSql).toContain('"version":2');
  });

  it("accepts later columns when replaying a historical manifest snapshot", async () => {
    const historicalManifest = {
      name: "reef_new_table",
      columns: [{ name: "value", type: "text" as const }],
    };
    const { calls } = setupFetch([
      {
        body: {
          kind: "table",
          vault: "reef-sample",
          items: [
            {
              name: REEF_SETTINGS_TABLE,
              columns: REEF_DESIRED_TABLES.find(
                (table) => table.name === REEF_SETTINGS_TABLE,
              )?.columns,
            },
            {
              name: historicalManifest.name,
              columns: [
                ...historicalManifest.columns,
                { name: "later_column", type: "text" },
              ],
            },
          ],
        },
      },
      { body: makeSchemaVersionResponse(2) },
    ]);

    await reconcileWorkspaceSchema({
      adapter: makeAdapter(),
      vault: "reef-sample",
      desiredTables: [historicalManifest],
      schemaVersion: 2,
      allowAdditionalColumns: true,
    });

    expect(calls).toHaveLength(2);
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

  it("is a no-op when the schema stamp is current", async () => {
    const { calls } = setupFetch([
      { body: makeDesiredTablesResponse() },
      { body: makeSchemaVersionResponse() },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(2);
    const stampSql = JSON.parse(calls[1]?.init?.body as string).sql as string;
    expect(stampSql).toContain(
      `WHERE key = '${REEF_SETTINGS_SCHEMA_VERSION_KEY}'`,
    );
  });

  it("accepts AKB canonical numeric/jsonb aliases for a current schema", async () => {
    const canonicalTables = {
      kind: "table",
      vault: "reef-sample",
      items: REEF_DESIRED_TABLES.map((manifest) => ({
        name: manifest.name,
        columns: canonicalizeColumns(manifest.columns),
      })),
    };
    const { calls } = setupFetch([
      { body: canonicalTables },
      { body: makeSchemaVersionResponse() },
    ]);

    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });

    expect(calls).toHaveLength(2);
  });

  it("accepts a newly created attachment table after AKB canonicalizes its aliases", async () => {
    const attachmentManifest = REEF_DESIRED_TABLES.find(
      (manifest) => manifest.name === REEF_ATTACHMENTS_TABLE,
    );
    if (!attachmentManifest) throw new Error("Missing attachment manifest");
    const { calls } = setupFetch([
      { body: makeDesiredTablesResponseExcept(REEF_ATTACHMENTS_TABLE) },
      { status: 201, body: { name: REEF_ATTACHMENTS_TABLE } },
      {
        body: makeDesiredTablesResponse({
          [REEF_ATTACHMENTS_TABLE]: {
            columns: canonicalizeColumns(attachmentManifest.columns),
          },
        }),
      },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });

    expect(calls).toHaveLength(5);
  });

  it("backfills the schema stamp after verifying an unstamped matching manifest", async () => {
    const { calls } = setupFetch([
      { body: makeDesiredTablesResponse() },
      { body: makeSqlQueryResponse([], ["value"]) },
      { body: makeDesiredTablesResponse() },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(5);
    const deleteSql = JSON.parse(calls[3]?.init?.body as string).sql as string;
    const insertSql = JSON.parse(calls[4]?.init?.body as string).sql as string;
    expect(deleteSql).toContain(`DELETE FROM ${REEF_SETTINGS_TABLE}`);
    expect(deleteSql).toContain(`'${REEF_SETTINGS_SCHEMA_VERSION_KEY}'`);
    expect(insertSql).toContain(`INSERT INTO ${REEF_SETTINGS_TABLE}`);
    expect(insertSql).toContain(`"version":${REEF_SCHEMA_VERSION}`);
  });

  it("fails hard instead of stamping when an existing table schema mismatches", async () => {
    const mismatchedActivity = {
      columns: [
        { name: "reef_id", type: "text", required: true },
        { name: "event_type", type: "text", required: true },
        { name: "payload", type: "json" },
        { name: "meta", type: "json" },
      ],
    };
    const { calls } = setupFetch([
      {
        body: makeDesiredTablesResponse({
          [REEF_ACTIVITY_TABLE]: mismatchedActivity,
        }),
      },
    ]);
    const adapter = makeAdapter();
    await expect(
      ensureReefTables({ adapter, vault: "reef-sample" }),
    ).rejects.toMatchObject({ name: "SchemaValidationError" });
    expect(calls).toHaveLength(1);
  });

  it("absorbs create 409 only after a refreshed manifest matches", async () => {
    const { calls } = setupFetch([
      { body: makeDesiredTablesResponseExcept(REEF_ACTIVITY_TABLE) },
      { status: 409, body: { detail: "already exists" } },
      { body: makeDesiredTablesResponse() },
      { body: makeDesiredTablesResponse() },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await ensureReefTables({ adapter, vault: "reef-sample" });
    expect(calls).toHaveLength(6);
    const createBody = JSON.parse(calls[1]?.init?.body as string);
    expect(createBody.name).toBe(REEF_ACTIVITY_TABLE);
    const insertSql = JSON.parse(calls[5]?.init?.body as string).sql as string;
    expect(insertSql).toContain(`"version":${REEF_SCHEMA_VERSION}`);
  });

  it("propagates create 409 when the refreshed manifest does not match", async () => {
    const mismatchedActivity = {
      name: REEF_ACTIVITY_TABLE,
      columns: [
        { name: "reef_id", type: "text", required: true },
        { name: "event_type", type: "text", required: true },
      ],
    };
    const { calls } = setupFetch([
      { body: makeDesiredTablesResponseExcept(REEF_ACTIVITY_TABLE) },
      { status: 409, body: { detail: "already exists" } },
      {
        body: {
          kind: "table",
          vault: "reef-sample",
          items: [
            ...(
              makeDesiredTablesResponseExcept(REEF_ACTIVITY_TABLE) as {
                items: unknown[];
              }
            ).items,
            mismatchedActivity,
          ],
        },
      },
    ]);
    const adapter = makeAdapter();
    await expect(
      ensureReefTables({ adapter, vault: "reef-sample" }),
    ).rejects.toMatchObject({ name: "ConflictError" });
    expect(calls).toHaveLength(3);
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
