import { describe, expect, it } from "vitest";
import { deleteTemplate } from "./templates";
import {
  ALL_REEF_TABLES,
  SAMPLE_TEMPLATE,
  TEMPLATE_ROW_COLUMNS,
  listTemplates,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  makeTemplateRow,
  readTemplate,
  sqlRequestBody,
  setupFetch,
  writeTemplate,
} from "../core/akb.testSupport";

describe("templates", () => {
  it("reads and writes retained issue templates", async () => {
    const { calls: readCalls } = setupFetch([
      { body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS) },
    ]);
    await expect(
      readTemplate({
        adapter: makeAdapter(),
        vault: "reef-sample",
        name: "bug-report",
      }),
    ).resolves.toMatchObject({ template: { name: "bug-report" } });
    expect(sqlRequestBody(readCalls[0])).toEqual({
      sql: "SELECT * FROM reef_templates WHERE name = $1",
      params: ["bug-report"],
    });

    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([], TEMPLATE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);
    await writeTemplate({
      adapter: makeAdapter(),
      vault: "reef-sample",
      template: SAMPLE_TEMPLATE,
    });
    expect(calls).toHaveLength(3);
    expect(sqlRequestBody(calls[1])).toEqual({
      sql: "SELECT * FROM reef_templates WHERE name = $1",
      params: [SAMPLE_TEMPLATE.name],
    });
    expect(sqlRequestBody(calls[2])).toEqual({
      sql: 'INSERT INTO reef_templates ("name", "label", "description", "title_prefix", "priority", "default_labels", "body") VALUES ($1, $2, $3, $4, $5, $6::json, $7)',
      params: [
        SAMPLE_TEMPLATE.name,
        SAMPLE_TEMPLATE.label,
        SAMPLE_TEMPLATE.description,
        SAMPLE_TEMPLATE.title_prefix,
        null,
        JSON.stringify(SAMPLE_TEMPLATE.default_labels),
        SAMPLE_TEMPLATE.body,
      ],
    });
  });

  it("parameterizes an existing row with special characters and nullable fields", async () => {
    const template = {
      name: "bug-report",
      label: "it's \\ 한글😀",
      description: "description's \\ 한글😀",
      default_labels: ["it's", "\\", "한글😀"],
      body: "body's \\ 한글😀",
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [makeTemplateRow(template)],
          TEMPLATE_ROW_COLUMNS,
        ),
      },
      { body: makeSqlMutationResponse("UPDATE 1") },
    ]);

    await writeTemplate({
      adapter: makeAdapter(),
      vault: "reef-sample",
      template,
    });

    expect(sqlRequestBody(calls[2])).toEqual({
      sql: 'UPDATE reef_templates SET "label" = $1, "description" = $2, "title_prefix" = $3, "priority" = $4, "default_labels" = $5::json, "body" = $6 WHERE name = $7',
      params: [
        template.label,
        template.description,
        null,
        null,
        JSON.stringify(template.default_labels),
        template.body,
        template.name,
      ],
    });
  });

  it("round-trips special characters, nullable fields, and JSON labels from a row", async () => {
    const template = {
      name: "bug-report",
      label: "it's \\ 한글😀",
      description: "description's \\ 한글😀",
      default_labels: ["it's", "\\", "한글😀"],
      body: "body's \\ 한글😀",
    };
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeTemplateRow(template)],
          TEMPLATE_ROW_COLUMNS,
        ),
      },
    ]);

    await expect(
      readTemplate({
        adapter: makeAdapter(),
        vault: "reef-sample",
        name: template.name,
      }),
    ).resolves.toEqual({ template });
    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "SELECT * FROM reef_templates WHERE name = $1",
      params: [template.name],
    });
  });

  it("lists templates from the retained table", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS) },
    ]);
    await expect(
      listTemplates({ adapter: makeAdapter(), vault: "reef-sample" }),
    ).resolves.toEqual([
      { template: expect.objectContaining({ name: "bug-report" }) },
    ]);
    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "SELECT * FROM reef_templates",
    });
  });

  it("parameterizes delete names and preserves missing-table no-op behavior", async () => {
    const name = "it's\\한글😀";
    const { calls } = setupFetch([
      { body: makeSqlMutationResponse("DELETE 1") },
    ]);

    await deleteTemplate({
      adapter: makeAdapter(),
      vault: "reef-sample",
      name,
    });

    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "DELETE FROM reef_templates WHERE name = $1",
      params: [name],
    });

    setupFetch([
      { body: { error: 'relation "reef_templates" does not exist' } },
    ]);
    await expect(
      deleteTemplate({ adapter: makeAdapter(), vault: "reef-sample", name }),
    ).resolves.toBeUndefined();
  });
});
