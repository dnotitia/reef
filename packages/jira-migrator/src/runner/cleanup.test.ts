import { describe, expect, it } from "vitest";
import { finalizeJiraCleanup } from "./cleanup.js";

describe("Jira migration cleanup", () => {
  it("reports every cleanup failure while preserving the primary failure", async () => {
    const primary = new Error("primary");
    const spool = new Error("spool");
    const firstRelease = new Error("first-release");
    const calls: string[] = [];

    await expect(
      finalizeJiraCleanup({
        primaryError: primary,
        steps: [
          async () => {
            calls.push("spool");
            throw spool;
          },
          async () => {
            calls.push("second");
          },
          async () => {
            calls.push("first");
            throw firstRelease;
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: "jira_migration_cleanup_failed",
      errors: [primary, spool, firstRelease],
    });
    expect(calls).toEqual(["spool", "second", "first"]);
  });
});
