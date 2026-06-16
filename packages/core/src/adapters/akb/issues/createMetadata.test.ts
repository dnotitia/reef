import { describe, expect, it } from "vitest";
import { buildIssueMetadataFromCreateInput } from "./createMetadata";

const BASE = { id: "REEF-001", now: "2026-06-10T00:00:00.000Z" } as const;

describe("buildIssueMetadataFromCreateInput", () => {
  it("defaults a new issue to backlog when the create input omits status (REEF-130)", () => {
    const issue = buildIssueMetadataFromCreateInput({
      ...BASE,
      create: { fields: { title: "New" }, content: "" },
    });

    expect(issue.status).toBe("backlog");
  });

  it("honors an explicit status on the create input (AI draft inferred status)", () => {
    const issue = buildIssueMetadataFromCreateInput({
      ...BASE,
      create: {
        fields: { title: "From a merged PR", status: "done" },
        content: "",
      },
    });

    expect(issue.status).toBe("done");
  });

  it("treats an explicit todo the same as any other supplied status", () => {
    // A caller may still pin `todo` deliberately; just an *absent* status falls
    // back to the backlog default.
    const issue = buildIssueMetadataFromCreateInput({
      ...BASE,
      create: { fields: { title: "Committed", status: "todo" }, content: "" },
    });

    expect(issue.status).toBe("todo");
  });

  it("leaves a new issue unranked when the create input omits rank (REEF-129)", () => {
    // New issues (manual create and AI draft) carry no manual order: rank stays
    // unset so the issue sorts into the backlog tail until a PM drags it.
    const issue = buildIssueMetadataFromCreateInput({
      ...BASE,
      create: { fields: { title: "New" }, content: "" },
    });

    expect(issue.rank).toBeUndefined();
  });
});
