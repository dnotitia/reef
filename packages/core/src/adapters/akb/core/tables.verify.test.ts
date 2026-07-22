// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { REEF_DESIRED_TABLES, REEF_SCHEMA_VERSION } from "./tableManifest";
import { verifyWorkspaceSchema } from "./tables";

describe("verifyWorkspaceSchema", () => {
  it("reads the manifest and version without any mutation", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "table",
        vault: "reef-sample",
        items: REEF_DESIRED_TABLES.map((table) => ({
          name: table.name,
          columns: table.columns,
        })),
      })
      .mockResolvedValueOnce({
        kind: "table_query",
        vaults: ["reef-sample"],
        columns: ["value"],
        items: [
          {
            value: JSON.stringify({
              version: REEF_SCHEMA_VERSION,
              applied_at: "2026-07-22T00:00:00.000Z",
            }),
          },
        ],
        total: 1,
      });
    await expect(
      verifyWorkspaceSchema({ adapter: { request }, vault: "reef-sample" }),
    ).resolves.toEqual({
      schemaVersion: REEF_SCHEMA_VERSION,
      manifestVerified: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(request.mock.calls[1]?.[0]).toContain("/sql");
    expect(request.mock.calls[1]?.[1]?.body).toMatchObject({
      sql: expect.stringMatching(/^SELECT /),
    });
  });
});
