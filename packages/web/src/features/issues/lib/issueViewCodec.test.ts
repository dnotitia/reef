// @vitest-environment node
import type { SavedIssueViewPayload } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  buildIssueSearchParams,
  canonicalIssueQuery,
  createSavedIssueViewPayload,
  isIssuesListPath,
  savedIssueViewDefaultIsStale,
  savedIssueViewHref,
  savedIssueViewIsActive,
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
    expect(
      savedIssueViewIsActive(
        payload,
        new URLSearchParams(
          "status=todo&status=in_progress&labels=backend&q=schema&sort=priority&order=desc&view=list",
        ),
      ),
    ).toBe(true);
  });

  it("drops invalid members, unknown keys, and fieldless order independently", () => {
    const payload = {
      version: 1,
      query: {
        status: ["todo", "not-a-status", ""],
        type: ["task", "not-a-type"],
        priority: ["high", "not-a-priority"],
        severity: ["critical", "not-a-severity"],
        due: ["overdue", "later"],
        order: ["desc"],
        unknown: ["value"],
      },
    } as unknown as SavedIssueViewPayload;
    const params = savedIssueViewPayloadToSearchParams(payload);
    expect(params.toString()).toBe(
      "due=overdue&priority=high&severity=critical&status=todo&type=task",
    );
    expect(savedIssueViewHref("reef-e2e", payload)).toContain("status=todo");
  });

  it("links a fully inapplicable legacy payload to an explicit empty view", () => {
    const payload = {
      version: 1,
      query: {
        status: ["removed-status"],
        unknown: ["value"],
      },
    } as unknown as SavedIssueViewPayload;
    expect(savedIssueViewPayloadToSearchParams(payload).toString()).toBe("");
    expect(savedIssueViewHref("reef-e2e", payload)).toBe(
      "/workspace/reef-e2e/issues?filter=none",
    );
  });

  it("backfills the natural direction for a valid orderless sort", () => {
    expect(canonicalIssueQuery("sort=updated_at")).toBe(
      "order=desc&sort=updated_at",
    );
  });

  it("uses an explicit empty-filter marker for layout-only and empty views", () => {
    expect(
      savedIssueViewHref("reef-e2e", {
        version: 1,
        query: { view: ["list"] },
      }),
    ).toBe("/workspace/reef-e2e/issues?filter=none&view=list");
    expect(savedIssueViewHref("reef-e2e", { version: 1, query: {} })).toBe(
      "/workspace/reef-e2e/issues?filter=none",
    );
    expect(
      buildIssueSearchParams(
        {},
        "",
        new URLSearchParams("filter=none&view=list"),
      ),
    ).toBe("view=list&filter=none");
    expect(
      canonicalIssueQuery(
        buildIssueSearchParams(
          { status: ["todo"] },
          "",
          new URLSearchParams("filter=none&view=list"),
        ),
      ),
    ).toBe("status=todo&view=list");
  });

  it("canonicalizes explicit board mode to the saved default representation", () => {
    expect(canonicalIssueQuery("status=todo&view=board")).toBe("status=todo");
    expect(
      savedIssueViewIsActive(
        { version: 1, query: { status: ["todo"] } },
        new URLSearchParams("view=board&status=todo"),
      ),
    ).toBe(true);
  });
});
