// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalIssueQuery,
  createSavedIssueViewPayload,
  isIssuesListPath,
  savedIssueViewDefaultIsStale,
  savedIssueViewHref,
  savedIssueViewPayloadToSearchParams,
} from "./issueViewCodec";

describe("issueViewCodec", () => {
  it("only permits current-state updates on the exact vault issues list", () => {
    expect(isIssuesListPath("/workspace/reef-e2e/issues", "reef-e2e")).toBe(
      true,
    );
    expect(isIssuesListPath("/workspace/reef-e2e/settings", "reef-e2e")).toBe(
      false,
    );
    expect(isIssuesListPath("/workspace/other/issues", "reef-e2e")).toBe(false);
  });

  it("only treats a missing default as stale after a successful read", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(savedIssueViewDefaultIsStale(id, undefined, false)).toBe(false);
    expect(savedIssueViewDefaultIsStale(id, [], true)).toBe(true);
    expect(
      savedIssueViewDefaultIsStale(
        id,
        [
          {
            id,
            name: "Mine",
            name_key: "mine",
            owner: "alice",
            payload: { version: 1, query: {} },
          },
        ],
        true,
      ),
    ).toBe(false);
  });

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
