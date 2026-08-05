import { describe, expect, it } from "vitest";
import {
  buildNamedIssueFilterEnvelope,
  canonicalizeNamedIssueFilterName,
  hasNamedIssueFilterPayload,
  normalizeNamedIssueFilterEnvelope,
  normalizeNamedIssueFilterPayload,
} from "./namedIssueFilter";

describe("named issue filter canonicalization", () => {
  it("uses NFKC, trim, and locale-independent lowercase for names", () => {
    expect(canonicalizeNamedIssueFilterName("  Ａｃｔｉｖｅ  ")).toBe("active");
  });

  it("sorts and deduplicates array values while preserving a sort pair", () => {
    expect(
      normalizeNamedIssueFilterPayload({
        status: ["todo", "in_progress", "todo"],
        assignee: ["bob", "alice", "alice"],
        sortField: "title",
        sortOrder: "asc",
      }),
    ).toEqual({
      status: ["in_progress", "todo"],
      assignee: ["alice", "bob"],
      sortField: "title",
      sortOrder: "asc",
    });
  });

  it("drops empty values, fieldless sort order, and invalid fields without losing siblings", () => {
    expect(
      normalizeNamedIssueFilterPayload({
        status: ["todo", ""],
        assignee: ["", "alice"],
        label: " , UI, ui, ",
        sortOrder: "desc",
        priority: ["not-a-priority", "high"],
        showArchived: false,
      }),
    ).toEqual({
      status: ["todo"],
      assignee: ["alice"],
      label: "ui",
      priority: ["high"],
    });
  });

  it("normalizes malformed envelope payloads to an unappliable empty payload", () => {
    const item = normalizeNamedIssueFilterEnvelope({
      version: 1,
      id: "filter-1",
      name: "  Saved  ",
      nameKey: "wrong-key",
      payload: { sortOrder: "asc" },
    });
    expect(item).toEqual({
      version: 1,
      id: "filter-1",
      name: "Saved",
      nameKey: "saved",
      payload: {},
    });
    expect(hasNamedIssueFilterPayload(item?.payload)).toBe(false);
  });

  it("builds a versioned envelope with a canonical display name and payload", () => {
    expect(
      buildNamedIssueFilterEnvelope({
        id: "filter-1",
        name: "  Ａｃｔｉｖｅ  ",
        payload: { sortField: "due_date" },
      }),
    ).toEqual({
      version: 1,
      id: "filter-1",
      name: "Active",
      nameKey: "active",
      payload: { sortField: "due_date", sortOrder: "asc" },
    });
  });
});
