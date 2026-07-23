import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

afterEach(() => vi.restoreAllMocks());

describe("reef-jira-migrator CLI", () => {
  it("rejects a missing mode before invoking the runner", async () => {
    const run = vi.fn();
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    expect(await main([], {}, { run })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "Exactly one of --dry-run or --apply is required",
      ),
    );
  });

  it("prints only bounded final artifact identity", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const run = vi.fn(async () => ({
      runId: "run-1",
      mode: "dry-run" as const,
      planSha256: "a".repeat(64),
      report: {
        run: { status: "completed" },
      },
      ledger: {},
    }));
    const code = await main(
      [
        "--dry-run",
        "--project-key",
        "ALPHA",
        "--mapping-policy",
        "ALPHA=/private/policy.json",
        "--jira-cloud-id",
        "cloud-1",
        "--vault",
        "reef-test",
        "--ledger-path",
        "/private/ledger.json",
        "--archive-root",
        "/private/archive",
        "--account-mapping-path",
        "/private/accounts.json",
        "--report-path",
        "/private/report.json",
      ],
      {
        REEF_JIRA_BASE_URL: "https://jira.test",
        REEF_JIRA_BEARER_TOKEN: "jira-canary",
        AKB_BACKEND_URL: "https://akb.test",
        REEF_AKB_JWT: "akb-canary",
      },
      { run: run as never },
    );
    expect(code).toBe(0);
    const output = String(stdout.mock.calls[0]?.[0]);
    expect(output).toContain('"run_id":"run-1"');
    expect(output).toContain('"report_path":"/private/report.json"');
    expect(output).not.toMatch(/jira-canary|akb-canary/u);
  });
});
