// @vitest-environment node

import type { IssueListItem } from "@reef/core";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  flattenIssueListPages,
  issueListInfiniteKey,
  mapIssueListCache,
  prependIssueToIssueListCache,
  restoreIssueListCacheItems,
  updateIssueListCaches,
} from "./issueListCache";

const issue = (id: string): IssueListItem => ({
  id,
  title: id,
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
});

const query = { sort_field: "priority", sort_order: "desc" };

function infiniteData() {
  return {
    pages: [
      { issues: [issue("REEF-001"), issue("REEF-002")], next_cursor: "c1" },
      { issues: [issue("REEF-002"), issue("REEF-003")] },
    ],
    pageParams: [null, "c1"],
  };
}

describe("issue list cache shapes", () => {
  it("flattens loaded infinite pages and removes cursor-boundary duplicates", () => {
    expect(flattenIssueListPages(infiniteData())).toEqual([
      issue("REEF-001"),
      issue("REEF-002"),
      issue("REEF-003"),
    ]);
  });

  it("maps every loaded infinite page without changing its envelope", () => {
    const key = issueListInfiniteKey("reef-acme", query);
    const result = mapIssueListCache(key, infiniteData(), (issues) =>
      issues.map((item) => ({ ...item, title: `Updated ${item.id}` })),
    ) as ReturnType<typeof infiniteData>;

    expect(
      result.pages.map((page) => page.issues.map((item) => item.title)),
    ).toEqual([
      ["Updated REEF-001", "Updated REEF-002"],
      ["Updated REEF-002", "Updated REEF-003"],
    ]);
    expect(result.pages.map((page) => page.next_cursor)).toEqual([
      "c1",
      undefined,
    ]);
    expect(result.pageParams).toEqual([null, "c1"]);
  });

  it("updates finite and infinite caches through one mutation transform", () => {
    const client = new QueryClient();
    const finiteKey = ["issues", "list", "reef-acme"] as const;
    const infiniteKey = issueListInfiniteKey("reef-acme", query);
    client.setQueryData(finiteKey, [issue("REEF-001"), issue("REEF-002")]);
    client.setQueryData(infiniteKey, infiniteData());

    const snapshots = updateIssueListCaches(client, "reef-acme", (item) =>
      item.id === "REEF-002" ? { ...item, status: "done" } : item,
    );

    expect(snapshots).toHaveLength(2);
    expect(client.getQueryData<IssueListItem[]>(finiteKey)).toEqual([
      issue("REEF-001"),
      { ...issue("REEF-002"), status: "done" },
    ]);
    const updatedInfinite =
      client.getQueryData<ReturnType<typeof infiniteData>>(infiniteKey);
    expect(
      updatedInfinite?.pages.map((page) =>
        page.issues.map((item) => item.status),
      ),
    ).toEqual([
      ["todo", "done"],
      ["done", "todo"],
    ]);
  });

  it("prepends a created issue only once to both cache shapes", () => {
    const created = issue("REEF-004");
    const finiteKey = ["issues", "list", "reef-acme"] as const;
    const infiniteKey = issueListInfiniteKey("reef-acme", query);

    const finite = prependIssueToIssueListCache(
      finiteKey,
      [issue("REEF-001")],
      created,
    );
    expect(prependIssueToIssueListCache(finiteKey, finite, created)).toEqual([
      created,
      issue("REEF-001"),
    ]);
    const prepended = prependIssueToIssueListCache(
      infiniteKey,
      infiniteData(),
      created,
    ) as ReturnType<typeof infiniteData>;
    const twice = prependIssueToIssueListCache(
      infiniteKey,
      prepended,
      created,
    ) as ReturnType<typeof infiniteData>;
    expect(
      twice.pages.map((page) => page.issues.map((item) => item.id)),
    ).toEqual([
      ["REEF-004", "REEF-001", "REEF-002"],
      ["REEF-002", "REEF-003"],
    ]);
    expect(twice.pageParams).toEqual([null, "c1"]);
    expect(twice.pages[0]?.next_cursor).toBe("c1");
  });

  it("restores one failed issue without erasing a sibling optimistic update", () => {
    const client = new QueryClient();
    const finiteKey = ["issues", "list", "reef-acme"] as const;
    const infiniteKey = issueListInfiniteKey("reef-acme", query);
    client.setQueryData(finiteKey, [issue("REEF-001"), issue("REEF-002")]);
    client.setQueryData(infiniteKey, infiniteData());

    const snapshots = updateIssueListCaches(client, "reef-acme", (item) =>
      item.id === "REEF-001" ? { ...item, status: "in_progress" } : item,
    );
    updateIssueListCaches(client, "reef-acme", (item) =>
      item.id === "REEF-002" ? { ...item, status: "done" } : item,
    );

    restoreIssueListCacheItems(client, snapshots, "REEF-001");

    expect(
      client
        .getQueryData<IssueListItem[]>(finiteKey)
        ?.map((item) => item.status),
    ).toEqual(["todo", "done"]);
    const restoredInfinite =
      client.getQueryData<ReturnType<typeof infiniteData>>(infiniteKey);
    expect(
      restoredInfinite?.pages[0]?.issues.map((item) => item.status),
    ).toEqual(["todo", "done"]);
  });
});
