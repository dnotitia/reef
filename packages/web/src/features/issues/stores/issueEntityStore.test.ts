// @vitest-environment node
import type { IssueListItem } from "@reef/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getIssueEntity,
  issueEntityStore,
  purgeAll,
  purgeAllExcept,
  purgeVault,
  removeIssue,
  upsertIssue,
  upsertIssues,
} from "./issueEntityStore";

function item(id: string, over: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id,
    title: id,
    status: "todo",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "alice",
    ...over,
  } as IssueListItem;
}

beforeEach(() => purgeAll());

describe("issueEntityStore", () => {
  it("upserts and reads entities per vault", () => {
    upsertIssues("v1", [item("REEF-1"), item("REEF-2")]);
    expect(getIssueEntity("v1", "REEF-1")?.id).toBe("REEF-1");
    expect(getIssueEntity("v1", "REEF-2")?.id).toBe("REEF-2");
  });

  it("isolates vaults: a lookup never crosses workspaces", () => {
    upsertIssues("v1", [item("REEF-1")]);
    upsertIssues("v2", [item("REEF-9")]);
    expect(getIssueEntity("v2", "REEF-1")).toBeUndefined();
    expect(getIssueEntity("v1", "REEF-9")).toBeUndefined();
  });

  it("preserves state ref when a batch brings no changed entity ref", () => {
    const a = item("REEF-1");
    upsertIssues("v1", [a]);
    const before = issueEntityStore.state;
    // Re-upserting the SAME object refs (what TanStack Query structural sharing
    // yields for unchanged rows on a refetch) must not produce new state.
    upsertIssues("v1", [a]);
    expect(issueEntityStore.state).toBe(before);
  });

  it("replaces only the changed entity, keeping siblings' refs stable", () => {
    const a = item("REEF-1");
    const b = item("REEF-2");
    upsertIssues("v1", [a, b]);
    const aRef = getIssueEntity("v1", "REEF-1");
    upsertIssue("v1", item("REEF-2", { title: "edited" }));
    expect(getIssueEntity("v1", "REEF-1")).toBe(aRef); // sibling untouched
    expect(getIssueEntity("v1", "REEF-2")?.title).toBe("edited");
  });

  it("removeIssue drops one entity", () => {
    upsertIssues("v1", [item("REEF-1"), item("REEF-2")]);
    removeIssue("v1", "REEF-1");
    expect(getIssueEntity("v1", "REEF-1")).toBeUndefined();
    expect(getIssueEntity("v1", "REEF-2")?.id).toBe("REEF-2");
  });

  it("purgeVault clears one workspace only", () => {
    upsertIssues("v1", [item("REEF-1")]);
    upsertIssues("v2", [item("REEF-9")]);
    purgeVault("v1");
    expect(getIssueEntity("v1", "REEF-1")).toBeUndefined();
    expect(getIssueEntity("v2", "REEF-9")?.id).toBe("REEF-9");
  });

  it("purgeAllExcept keeps the active vault, drops the rest", () => {
    upsertIssues("v1", [item("REEF-1")]);
    upsertIssues("v2", [item("REEF-9")]);
    purgeAllExcept("v2");
    expect(getIssueEntity("v1", "REEF-1")).toBeUndefined();
    expect(getIssueEntity("v2", "REEF-9")?.id).toBe("REEF-9");
  });

  it("purgeAll empties the store", () => {
    upsertIssues("v1", [item("REEF-1")]);
    purgeAll();
    expect(issueEntityStore.state.byVault).toEqual({});
  });
});
