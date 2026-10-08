// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REEF_VAULT } from "../tests/e2e/harness/mock-fixtures.mjs";
import { handleSql } from "../tests/e2e/harness/mock-sql.mjs";
import { createState } from "../tests/e2e/harness/mock-state.mjs";

describe("issue-list failure fixture modes", () => {
  it.each([
    [409, { kind: "sql_error", status: 409 }],
    [500, { kind: "sql_error", status: 500 }],
    [503, { kind: "sql_error", status: 503 }],
    ["network", { kind: "transport_error" }],
  ] as const)("selects the configured %s response", (failureMode, expected) => {
    const state = createState("sprint_rollover") as Omit<
      ReturnType<typeof createState>,
      "issueListFailureStatus"
    > & {
      issueListFailure: boolean;
      issueListFailureStatus: 409 | 500 | 503 | "network" | null;
    };
    const vault = state.vaults.get(REEF_VAULT);
    if (!vault) throw new Error("sprint rollover fixture is missing");
    state.issueListFailure = true;
    state.issueListFailureStatus = failureMode;

    expect(
      handleSql(
        state,
        vault,
        "SELECT * FROM reef_issues WHERE archived_at IS NULL",
        "alice",
      ),
    ).toMatchObject(expected);
  });
});
