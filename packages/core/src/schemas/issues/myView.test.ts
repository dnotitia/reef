import { describe, expect, it } from "vitest";
import {
  MyViewOrderingSchema,
  buildMyViewEnvelope,
  canonicalizeMyViewName,
  normalizeMyViewEnvelope,
  normalizeMyViewSnapshot,
  serializeMyViewSnapshot,
} from "./myView";

describe("My View schema", () => {
  it("canonicalizes names and builds a versioned actor/vault envelope", () => {
    const view = buildMyViewEnvelope({
      id: "view-1",
      name: "  Ｔriage  ",
      owner: "alice",
      vault: "reef-acme",
      snapshot: {
        filter: { status: ["todo"], sortOrder: "desc" },
        scope: "active",
        layout: "list",
        grouping: "none",
        ordering: { mode: "manual", issueIds: ["one"] },
        display: { listColumns: ["release", "start", "nope"] },
        rank: ["must not persist"],
      },
    });

    expect(canonicalizeMyViewName("  Ｔriage  ")).toBe("triage");
    expect(view).toMatchObject({
      version: 1,
      id: "view-1",
      name: "Triage",
      nameKey: "triage",
      owner: "alice",
      vault: "reef-acme",
      snapshot: {
        filter: { status: ["todo"] },
        ordering: { mode: "manual" },
        display: { listColumns: ["start", "release"] },
      },
    });
    expect(JSON.stringify(view)).not.toContain("issueIds");
    expect(JSON.stringify(view)).not.toContain("rank");
  });

  it("keeps valid fields while normalizing unsupported workspace combinations", () => {
    const snapshot = normalizeMyViewSnapshot({
      filter: {
        status: ["removed", "todo"],
        priority: ["high"],
        priorityUnset: true,
        severityUnset: true,
        assigneeUnset: true,
        due: ["no_due"],
        label: " UI, ui ",
      },
      scope: "backlog",
      layout: "timeline",
      grouping: "status",
      ordering: { mode: "field", field: "due_date" },
      display: {
        showArchived: true,
        showStale: "yes",
        listColumns: ["release", "invalid", "start", "start"],
      },
    });

    expect(snapshot).toEqual({
      filter: {
        status: ["todo"],
        priority: ["high"],
        priorityUnset: true,
        severityUnset: true,
        assigneeUnset: true,
        due: ["no_due"],
        label: "ui",
      },
      scope: "backlog",
      layout: "list",
      grouping: "priority",
      ordering: { mode: "field", field: "due_date", direction: "asc" },
      display: { showArchived: true, listColumns: ["start", "release"] },
    });
  });

  it("requires an explicit direction for a field ordering schema", () => {
    expect(
      MyViewOrderingSchema.safeParse({ mode: "field", field: "priority" })
        .success,
    ).toBe(false);
    expect(
      MyViewOrderingSchema.safeParse({
        mode: "field",
        field: "priority",
        direction: "desc",
      }).success,
    ).toBe(true);
  });

  it("drops obsolete or unsupported envelope versions without compatibility reads", () => {
    expect(
      normalizeMyViewEnvelope({
        version: 99,
        id: "old",
        name: "Old",
        nameKey: "old",
        owner: "alice",
        vault: "reef-acme",
        payload: { status: ["todo"] },
      }),
    ).toBeNull();
    expect(
      serializeMyViewSnapshot({
        filter: {},
        scope: "active",
        layout: "board",
        grouping: "status",
        ordering: { mode: "manual" },
        display: {},
      }),
    ).toContain('"ordering":{"mode":"manual"}');
  });
});
