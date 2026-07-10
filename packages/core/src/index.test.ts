import { describe, expect, it } from "vitest";
import {
  AgentExecutionStatusEnum,
  AgentRunRecordSchema,
  akbReadAgentRunWithIssueStatus,
} from ".";

describe("@reef/core", () => {
  it("package exports successfully", () => {
    expect(true).toBe(true);
  });

  it("exports durable agent run schemas and akb adapters from the package root", () => {
    expect(AgentExecutionStatusEnum.options).toContain("queued");
    expect(
      AgentRunRecordSchema.safeParse({
        run_id: "run-1",
        reef_id: "REEF-380",
        active_reef_id: "REEF-380",
        task_id: "reef.issue.run",
        status: "queued",
        phase: "queued",
        queued_at: "2026-07-09T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(typeof akbReadAgentRunWithIssueStatus).toBe("function");
  });
});
