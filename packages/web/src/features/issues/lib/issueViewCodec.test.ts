// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalIssueQuery,
  createSavedIssueViewPayload,
  savedIssueViewHref,
  savedIssueViewPayloadToSearchParams,
} from "./issueViewCodec";

describe("issueViewCodec", () => {
  it("round-trips a deterministic saved payload", () => {
    const payload = createSavedIssueViewPayload(
      {
        status: ["todo", "in_progress"],
        label: "backend",
        sortField: "priority",
        sortOrder: "desc",
      },
      "schema",
      "list",
    );
    expect(savedIssueViewHref("reef-e2e", payload)).toBe(
      "/workspace/reef-e2e/issues?labels=backend&order=desc&q=schema&sort=priority&status=in_progress&status=todo&view=list",
    );
  });

  it("drops invalid members, unknown keys, and fieldless order independently", () => {
    const params = savedIssueViewPayloadToSearchParams({
      version: 1,
      query: {
        status: ["todo", "not-a-status", ""],
        due: ["overdue", "later"],
        order: ["desc"],
        unknown: ["value"],
      },
    });
    expect(params.toString()).toBe("due=overdue&status=todo");
  });

  it("backfills the natural direction for a valid orderless sort", () => {
    expect(canonicalIssueQuery("sort=updated_at")).toBe(
      "order=desc&sort=updated_at",
    );
  });
});
