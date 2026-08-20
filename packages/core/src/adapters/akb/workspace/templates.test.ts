import { describe, expect, it } from "vitest";
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
  setupFetch,
  writeTemplate,
} from "../core/akb.testSupport";

describe("templates", () => {
  it("reads and writes retained issue templates", async () => {
    setupFetch([
      { body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS) },
    ]);
    await expect(
      readTemplate({
        adapter: makeAdapter(),
        vault: "reef-sample",
        name: "bug-report",
      }),
    ).resolves.toMatchObject({ template: { name: "bug-report" } });

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
    expect(JSON.parse(calls[2]?.init?.body as string).sql).toContain(
      "INSERT INTO reef_templates",
    );
  });

  it("lists templates from the retained table", async () => {
    setupFetch([
      { body: makeSqlQueryResponse([makeTemplateRow()], TEMPLATE_ROW_COLUMNS) },
    ]);
    await expect(
      listTemplates({ adapter: makeAdapter(), vault: "reef-sample" }),
    ).resolves.toEqual([
      { template: expect.objectContaining({ name: "bug-report" }) },
    ]);
  });
});
