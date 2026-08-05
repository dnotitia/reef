// @vitest-environment node

import type { IssueListItem } from "@reef/core";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  flattenIssueListPages,
  issueListInfiniteKey,
  mapIssueListCache,
  prependIssueToIssueListCache,
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

    expect(result.pages[0]?.issues[0]?.title).toBe("Updated REEF-001");
    expect(result.pages[1]?.issues[1]?.id).toBe("REEF-003");
    expect(result.pageParams).toEqual([null, "c1"]);
  });

  it("updates finite and infinite caches through one mutation transform", () => {
    const client = new QueryClient();
    const finiteKey = ["issues", "list", "reef-acme"] as const;
    const infiniteKey = issueListInfiniteKey("reef-acme", query);
    client.setQueryData(finiteKey, [issue("REEF-001")]);
    client.setQueryData(infiniteKey, infiniteData());

    const snapshots = updateIssueListCaches(client, "reef-acme", (item) =>
      item.id === "REEF-002" ? { ...item, status: "done" } : item,
    );

    expect(snapshots).toHaveLength(2);
    expect(client.getQueryData<IssueListItem[]>(finiteKey)).toEqual([
      issue("REEF-001"),
    ]);
    expect(
      client.getQueryData<ReturnType<typeof infiniteData>>(infiniteKey)
        ?.pages[0]?.issues[1]?.status,
    ).toBe("done");
  });

  it("prepends a created issue only once to both cache shapes", () => {
    const created = issue("REEF-004");
    const finiteKey = ["issues", "list", "reef-acme"] as const;
    const infiniteKey = issueListInfiniteKey("reef-acme", query);

    expect(
      prependIssueToIssueListCache(finiteKey, [issue("REEF-001")], created),
    ).toEqual([created, issue("REEF-001")]);
    const prepended = prependIssueToIssueListCache(
      infiniteKey,
      infiniteData(),
      created,
    ) as ReturnType<typeof infiniteData>;
    expect(prepended.pages[0]?.issues[0]).toEqual(created);
    expect(prepended.pages[1]?.issues).toHaveLength(2);
  });
});
