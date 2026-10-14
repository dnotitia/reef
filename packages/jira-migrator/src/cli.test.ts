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
        privateDetail: "report-private-canary",
      },
      ledger: { privateDetail: "ledger-private-canary" },
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
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({
      run_id: "run-1",
      mode: "dry-run",
      plan_sha256: "a".repeat(64),
      report_path: "/private/report.json",
      status: "completed",
    });
    expect(output).not.toMatch(
      /jira-canary|akb-canary|report-private-canary|ledger-private-canary/u,
    );
  });

  it.each([undefined, "0", "1"])(
    "emits aggregate timings only when profiling is explicitly enabled (%s)",
    async (profileSetting) => {
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const run = vi.fn(async (_config, dependencies) => ({
        runId: "run-profile",
        mode: "dry-run" as const,
        planSha256: "b".repeat(64),
        report: {
          run: { status: "completed" },
        },
        ledger: {},
        profile: dependencies?.profiler?.snapshot(),
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
          REEF_JIRA_MIGRATOR_PROFILE: profileSetting,
        },
        { run: run as never },
      );

      expect(code).toBe(0);
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      if (profileSetting === "1") {
        expect(JSON.parse(output)).toMatchObject({
          jira_migration_profile: { kind: "final", metrics: [], active: [] },
        });
      } else {
        expect(output).toBe("");
      }
      expect(output).not.toMatch(/jira-canary|akb-canary/u);
    },
  );
});
