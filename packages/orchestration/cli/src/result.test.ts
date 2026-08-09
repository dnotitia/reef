import { describe, expect, it } from "vitest";
import {
  DeliveryProgressEventSchema,
  TerminalResultSchema,
  exitCodeForOutcome,
} from "./result.js";

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

  it("accepts safe structured validation repair progress", () => {
    expect(
      DeliveryProgressEventSchema.parse({
        schema_version: 1,
        event: "execution.validation",
        at: "2026-08-09T00:00:00.000Z",
        work_uri: "reef://reef-test/REEF-101",
        stage: "validation_repair",
        attempt: 2,
        candidate_revision: "b".repeat(40),
        previous_candidate_revision: "a".repeat(40),
      }),
    ).toMatchObject({
      stage: "validation_repair",
      attempt: 2,
      candidate_revision: "b".repeat(40),
      previous_candidate_revision: "a".repeat(40),
    });
  });
});
