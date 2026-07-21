import { describe, expect, it } from "vitest";
import { projectMigrationReport } from "./cli";

describe("schema migrator CLI report", () => {
  it("projects internal workspace details to bounded codes and counts", () => {
    const report = projectMigrationReport({
      ok: false,
      code: "migration_failed",
      targetVersion: 1,
      counts: { discovered: 3, reef: 2, rawSkipped: 1, completed: 1 },
      workspaces: [
        {
          vault: "private-vault",
          status: "applied",
          phases: [
            {
              phaseId: "018f47a4-8e3b-7f62-a3d2-9876543210ab",
              applied: true,
              checksum: "upstream-derived-checksum",
            },
          ],
        },
      ],
      failure: { vault: "private-vault" },
    });

    expect(report).toEqual({
      ok: false,
      code: "migration_failed",
      targetVersion: 1,
      counts: { discovered: 3, reef: 2, rawSkipped: 1, completed: 1 },
    });
    expect(JSON.stringify(report)).not.toContain("private-vault");
    expect(JSON.stringify(report)).not.toContain("checksum");
  });
});
