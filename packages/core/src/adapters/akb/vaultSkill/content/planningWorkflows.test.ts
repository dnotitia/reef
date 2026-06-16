import { describe, expect, it } from "vitest";
import { planningWorkflowsContent } from "./planningWorkflows";

// REEF-148: backlog (not committed yet) and a sprint (a commitment) should not
// coexist on one row. The runbook should say a backlog issue carries no sprint_id
// and that attaching a sprint promotes the issue out of backlog in the same
// write, while keeping milestone/release grouping separate from sprint
// commitment. These pins keep that rule from silently dropping out of the
// planning runbook.
describe("planning workflows — backlog and sprint commitment (REEF-148)", () => {
  const content = planningWorkflowsContent();

  it("states that a backlog issue carries no sprint", () => {
    expect(content).toContain("## Backlog and sprint commitment");
    expect(content).toMatch(/backlog issue carries no sprint_id/i);
  });

  it("promotes the issue out of backlog when a sprint is attached", () => {
    expect(content).toMatch(/move the issue out of backlog/i);
    // The status side effect should be recorded.
    expect(content).toContain("meta.last_status_change");
  });

  it("keeps milestone/release grouping separate from sprint commitment", () => {
    expect(content).toMatch(/milestone_id or release_id/i);
  });
});
