import { describe, expect, it } from "vitest";
import { TerminalResultSchema, exitCodeForOutcome } from "./result.js";

describe("terminal result contract", () => {
  it("keeps the fixed exit matrix", () => {
    expect(exitCodeForOutcome("succeeded")).toBe(0);
    expect(exitCodeForOutcome("failed")).toBe(1);
    expect(exitCodeForOutcome("blocked")).toBe(3);
    expect(exitCodeForOutcome("cancelled")).toBe(130);
  });

  it("rejects a terminal envelope with extra or unsafe fields", () => {
    expect(() =>
      TerminalResultSchema.parse({
        schema_version: 1,
        run_id: "run-test",
        work_uri: "reef://reef-test/REEF-101",
        outcome: "succeeded",
        plan: null,
        artifact_refs: [],
        cleanup: { outcomes: [] },
        failure: null,
        controller: null,
        next_actions: ["delivery_handoff_not_started"],
        raw_error: "should never be accepted",
      }),
    ).toThrow();
  });
});
