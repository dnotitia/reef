import { describe, expect, it } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { buildPutRequestBody } from "../core/shared";

const ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Fix the login flow",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
  labels: ["bug", "frontend"],
  depends_on: ["REEF-002"],
  blocks: ["REEF-003"],
  related_to: ["REEF-004"],
};

describe("buildPutRequestBody", () => {
  it("publishes the issue document as active (no draft noise in MCP grounding)", () => {
    // reef does not reads the document lifecycle status, but the akb default of
    // `draft` leaks into grounding and wastes agent tokens — REEF-035.
    expect(buildPutRequestBody("reef-acme", ISSUE, "body").status).toBe(
      "active",
    );
  });

  it("always sets the akb document type to task", () => {
    expect(buildPutRequestBody("reef-acme", ISSUE, "body").type).toBe("task");
  });

  it("stores under the issues collection with the human title as summary", () => {
    const out = buildPutRequestBody("reef-acme", ISSUE, "body");
    expect(out.collection).toBe("issues");
    expect(out.summary).toBe("Fix the login flow");
  });

  it("folds blocks into related_to and passes labels through as tags", () => {
    const out = buildPutRequestBody("reef-acme", ISSUE, "body");
    expect(out.tags).toEqual(["bug", "frontend"]);
    expect(out.depends_on).toEqual(["REEF-002"]);
    expect(out.related_to).toEqual(["REEF-003", "REEF-004"]);
  });
});
