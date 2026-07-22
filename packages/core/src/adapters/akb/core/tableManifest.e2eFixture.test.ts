// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REEF_DESIRED_TABLES } from "./tableManifest";

describe("E2E table manifest fixture", () => {
  it("stays identical to the production desired manifest", async () => {
    const path = resolve(
      process.cwd(),
      "../web/tests/e2e/harness/reef-table-manifest.json",
    );
    const fixture = JSON.parse(await readFile(path, "utf8"));
    const production = Object.fromEntries(
      REEF_DESIRED_TABLES.map((table) => [table.name, table.columns]),
    );

    expect(fixture).toEqual(production);
  });
});
