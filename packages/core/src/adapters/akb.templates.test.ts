import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  MONITORED_REPOS_TABLE,
  NotFoundError,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
  SAMPLE_TEMPLATE,
  TEMPLATE_ROW_COLUMNS,
  deleteTemplate,
  ensureReefTables,
  listTemplates,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  makeTemplateRow,
  readTemplate,
  setupFetch,
  writeTemplate,
} from "./akb.testSupport";
import type { Template } from "./akb.testSupport";

describe("templates", () => {
  it("reads a template from its reef_templates row by name", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS),
      },
    ]);
    const adapter = makeAdapter();
    const result = await readTemplate({
      adapter,
      vault: "reef-sample",
      name: "bug-report",
    });
    expect(result.template.name).toBe("bug-report");
    expect(result.template.label).toBe("Bug Report");
    expect(result.template.description).toBe("Standard bug report template");
    expect(result.template.title_prefix).toBe("Bug: ");
    expect(result.template.default_labels).toEqual(["bug"]);
    expect(result.template.body).toContain("## Repro");
    expect(calls[0]?.url).toContain("/api/v1/tables/reef-sample/sql");
    const sqlBody = JSON.parse(calls[0]?.init?.body as string);
    expect(sqlBody.sql).toContain("FROM reef_templates");
    expect(sqlBody.sql).toContain("name = 'bug-report'");
  });

  it("throws NotFoundError when no row matches the name", async () => {
    setupFetch([{ body: makeSqlQueryResponse([], TEMPLATE_ROW_COLUMNS) }]);
    const adapter = makeAdapter();
    await expect(
      readTemplate({ adapter, vault: "reef-sample", name: "missing" }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("INSERTs a new template when the name probe finds no existing row", async () => {
    const { calls } = setupFetch([
      // writeTemplate provisions the table lazily — all already present.
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      // probe SELECT: empty
      { body: makeSqlQueryResponse([], TEMPLATE_ROW_COLUMNS) },
      // INSERT
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await writeTemplate({
      adapter,
      vault: "reef-sample",
      template: SAMPLE_TEMPLATE,
    });
    expect(calls).toHaveLength(3);
    const probeSql = JSON.parse(calls[1]?.init?.body as string).sql;
    expect(probeSql).toContain("name = 'bug-report'");
    const insertSql = JSON.parse(calls[2]?.init?.body as string).sql;
    expect(insertSql).toContain("INSERT INTO reef_templates");
    expect(insertSql).toContain("'bug-report'");
    expect(insertSql).toContain("'Bug Report'");
    expect(insertSql).toContain("'Bug: '");
    expect(insertSql).toContain('["bug"]');
    expect(insertSql).toContain("## Repro");
  });

  it("provisions reef_templates then INSERTs when the table is missing", async () => {
    const { calls } = setupFetch([
      // ensureReefTables: nothing exists yet → creates all reef tables.
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
      { status: 201, body: { name: REEF_ACTIVITY_TABLE } },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      // probe SELECT: empty (table now exists)
      { body: makeSqlQueryResponse([], TEMPLATE_ROW_COLUMNS) },
      // INSERT
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    const adapter = makeAdapter();
    await expect(
      writeTemplate({
        adapter,
        vault: "reef-sample",
        template: SAMPLE_TEMPLATE,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(14);
    const createNames = calls
      .slice(1, 11)
      .map((c) => JSON.parse(c.init?.body as string).name);
    expect(createNames).toEqual(ALL_REEF_TABLES);
    const insertSql = JSON.parse(calls[13]?.init?.body as string).sql;
    expect(insertSql).toContain("INSERT INTO reef_templates");
  });

  it("UPDATEs an existing template (preserving the row) when the name probe finds a row", async () => {
    const { calls } = setupFetch([
      // writeTemplate provisions the table lazily — all already present.
      {
        body: makeListTablesResponse(ALL_REEF_TABLES),
      },
      // probe SELECT: existing row
      {
        body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS),
      },
      // UPDATE
      { body: makeSqlMutationResponse("UPDATE 1") },
    ]);
    const adapter = makeAdapter();
    const updated: Template = {
      ...SAMPLE_TEMPLATE,
      label: "Bug Report (v2)",
      default_labels: ["bug", "regression"],
    };
    await writeTemplate({
      adapter,
      vault: "reef-sample",
      template: updated,
    });
    expect(calls).toHaveLength(3);
    const updateSql = JSON.parse(calls[2]?.init?.body as string).sql;
    expect(updateSql).toContain("UPDATE reef_templates SET");
    expect(updateSql).toContain("'Bug Report (v2)'");
    expect(updateSql).toContain('["bug","regression"]');
    expect(updateSql).toContain("WHERE name = 'bug-report'");
    // The name key is does not part of the SET clause — rename is delete+create.
    expect(updateSql).not.toContain('"name" =');
  });

  it("deletes a template row by name", async () => {
    const { calls } = setupFetch([
      { body: makeSqlMutationResponse("DELETE 1") },
    ]);
    const adapter = makeAdapter();
    await deleteTemplate({
      adapter,
      vault: "reef-sample",
      name: "bug-report",
    });
    expect(calls[0]?.url).toContain("/api/v1/tables/reef-sample/sql");
    const sql = JSON.parse(calls[0]?.init?.body as string).sql;
    expect(sql).toContain("DELETE FROM reef_templates");
    expect(sql).toContain("WHERE name = 'bug-report'");
  });

  it("delete is a no-op when the reef_templates table does not exist", async () => {
    setupFetch([makeSqlRuntimeErrorResponse("reef_templates")]);
    const adapter = makeAdapter();
    await expect(
      deleteTemplate({ adapter, vault: "reef-sample", name: "bug-report" }),
    ).resolves.toBeUndefined();
  });

  it("lists templates with a single SELECT and full field roundtrip", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS),
      },
    ]);
    const adapter = makeAdapter();
    const list = await listTemplates({ adapter, vault: "reef-sample" });
    expect(list).toHaveLength(1);
    expect(list[0]?.template.name).toBe("bug-report");
    expect(list[0]?.template.default_labels).toEqual(["bug"]);
    expect(list[0]?.template.title_prefix).toBe("Bug: ");
    const sql = JSON.parse(calls[0]?.init?.body as string).sql;
    expect(sql).toContain("SELECT * FROM reef_templates");
  });

  it("returns an empty list when the reef_templates table does not exist", async () => {
    setupFetch([makeSqlRuntimeErrorResponse("reef_templates")]);
    const adapter = makeAdapter();
    const list = await listTemplates({ adapter, vault: "reef-sample" });
    expect(list).toEqual([]);
  });
});

// ── Vault meta ───────────────────────────────────────────────────────────────
