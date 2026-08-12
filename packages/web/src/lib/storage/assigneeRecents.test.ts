// @vitest-environment node

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assigneeRecentsStorageKey,
  getRecentAssigneeLogins,
  rememberRecentAssigneeLogin,
} from "./assigneeRecents";
import { db } from "./db";

describe("assignee recents storage", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
  });

  it("stores recent logins in a versioned actor/vault envelope", async () => {
    await rememberRecentAssigneeLogin("alice", "reef-acme", "bob");
    await rememberRecentAssigneeLogin("alice", "reef-acme", "carol");

    expect(await getRecentAssigneeLogins("alice", "reef-acme")).toEqual([
      "carol",
      "bob",
    ]);
    expect(await getRecentAssigneeLogins("bob", "reef-acme")).toEqual([]);
    expect(await getRecentAssigneeLogins("alice", "reef-other")).toEqual([]);
    await expect(
      db.config
        .where("key")
        .equals(assigneeRecentsStorageKey("alice", "reef-acme"))
        .first(),
    ).resolves.toMatchObject({
      value: JSON.stringify({ version: 1, logins: ["carol", "bob"] }),
    });
  });

  it("returns safe empty recents for corrupt or old envelopes", async () => {
    await db.config.add({
      key: assigneeRecentsStorageKey("alice", "reef-acme"),
      value: "not json",
    });
    expect(await getRecentAssigneeLogins("alice", "reef-acme")).toEqual([]);

    await db.config.put({
      id: 1,
      key: assigneeRecentsStorageKey("alice", "reef-old"),
      value: JSON.stringify({ version: 2, logins: ["bob"] }),
    });
    expect(await getRecentAssigneeLogins("alice", "reef-old")).toEqual([]);
  });

  it("keeps only login strings and deduplicates malformed envelope values", async () => {
    await db.config.add({
      key: assigneeRecentsStorageKey("alice", "reef-acme"),
      value: JSON.stringify({
        version: 1,
        logins: ["bob", "bob", null, 3, "carol"],
      }),
    });
    expect(await getRecentAssigneeLogins("alice", "reef-acme")).toEqual([
      "bob",
      "carol",
    ]);
  });
});
