// @vitest-environment node

import "fake-indexeddb/auto";

import type { MyViewSnapshot } from "@reef/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfigValue, setConfigValue } from "./config";
import { db } from "./db";
import {
  MyViewDuplicateError,
  clearAllMyViews,
  createMyView,
  deleteMyView,
  listMyViews,
  myViewStorageKey,
  updateMyView,
} from "./myView";

const snapshot: MyViewSnapshot = {
  filter: { status: ["todo"] },
  scope: "active",
  layout: "list",
  grouping: "none",
  ordering: { mode: "manual" },
  display: { listColumns: ["start"] },
};

describe("My View storage", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
    vi.restoreAllMocks();
  });

  it("round-trips a versioned view under an actor/vault/stable-id key", async () => {
    const view = await createMyView({
      actor: "alice",
      vault: "reef-acme",
      name: "  Ｔriage  ",
      snapshot,
    });

    expect(view).toMatchObject({
      version: 1,
      name: "Triage",
      nameKey: "triage",
      owner: "alice",
      vault: "reef-acme",
      snapshot,
    });
    expect(
      await getConfigValue(myViewStorageKey("alice", "reef-acme", view.id)),
    ).toContain('"version":1');
    expect(await listMyViews("alice", "reef-acme")).toEqual([view]);
  });

  it("keeps duplicate names and records independent per actor and vault", async () => {
    await createMyView({
      actor: "alice",
      vault: "reef-acme",
      name: "Shared",
      snapshot,
    });

    await expect(
      createMyView({
        actor: "alice",
        vault: "reef-acme",
        name: "  ｓｈａｒｅｄ ",
        snapshot,
      }),
    ).rejects.toBeInstanceOf(MyViewDuplicateError);

    await createMyView({
      actor: "bob",
      vault: "reef-acme",
      name: "Shared",
      snapshot,
    });
    await createMyView({
      actor: "alice",
      vault: "reef-zen",
      name: "Shared",
      snapshot,
    });

    expect(await listMyViews("alice", "reef-acme")).toHaveLength(1);
    expect(await listMyViews("bob", "reef-acme")).toHaveLength(1);
    expect(await listMyViews("alice", "reef-zen")).toHaveLength(1);
  });

  it("reads valid fields from a damaged snapshot and ignores obsolete representations", async () => {
    await setConfigValue(
      myViewStorageKey("alice", "reef-acme", "damaged"),
      JSON.stringify({
        version: 1,
        id: "damaged",
        name: "Needs cleanup",
        nameKey: "wrong",
        owner: "alice",
        vault: "reef-acme",
        snapshot: {
          filter: { status: ["removed", "todo"], priority: ["high"] },
          scope: "active",
          layout: "list",
          grouping: "none",
          ordering: { mode: "field", field: "updated_at" },
          display: { listColumns: ["release", "invalid", "start"] },
          issueIds: ["never-store"],
          rank: [1, 2],
        },
      }),
    );
    await setConfigValue(
      "named_filter:reef-acme:obsolete",
      JSON.stringify({ version: 1, id: "obsolete" }),
    );
    await setConfigValue(
      myViewStorageKey("alice", "reef-acme", "wrong-version"),
      JSON.stringify({
        version: 2,
        id: "wrong-version",
        name: "Old",
        nameKey: "old",
        owner: "alice",
        vault: "reef-acme",
        snapshot,
      }),
    );

    const [view] = await listMyViews("alice", "reef-acme");
    expect(view).toMatchObject({
      name: "Needs cleanup",
      nameKey: "needs cleanup",
      snapshot: {
        filter: { status: ["todo"], priority: ["high"] },
        ordering: { mode: "field", field: "updated_at", direction: "desc" },
        display: { listColumns: ["start", "release"] },
      },
    });
    expect(JSON.stringify(view)).not.toContain("issueIds");
    expect(JSON.stringify(view)).not.toContain("rank");
    expect(await listMyViews("alice", "reef-acme")).toHaveLength(1);
  });

  it("updates and deletes one view after the successful readback", async () => {
    const original = await createMyView({
      actor: "alice",
      vault: "reef-acme",
      name: "Triage",
      snapshot,
    });
    const updated = await updateMyView({
      actor: "alice",
      vault: "reef-acme",
      id: original.id,
      name: "Delivery",
      snapshot: {
        ...snapshot,
        ordering: { mode: "field", field: "title", direction: "asc" },
      },
    });

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe("Delivery");
    expect(await listMyViews("alice", "reef-acme")).toEqual([updated]);

    await deleteMyView({ actor: "alice", vault: "reef-acme", id: original.id });
    expect(await listMyViews("alice", "reef-acme")).toEqual([]);
  });

  it("does not leave a view behind when the config write fails", async () => {
    vi.spyOn(db.config, "add").mockRejectedValueOnce(new Error("write failed"));

    await expect(
      createMyView({
        actor: "alice",
        vault: "reef-acme",
        name: "Failed",
        snapshot,
      }),
    ).rejects.toThrow("write failed");
    expect(await listMyViews("alice", "reef-acme")).toEqual([]);
  });

  it("clears all actors and vaults without touching unrelated config", async () => {
    await createMyView({
      actor: "alice",
      vault: "reef-acme",
      name: "Acme",
      snapshot,
    });
    await createMyView({
      actor: "bob",
      vault: "reef-zen",
      name: "Zen",
      snapshot,
    });
    await setConfigValue("theme", "dark");

    await clearAllMyViews();

    expect(await listMyViews("alice", "reef-acme")).toEqual([]);
    expect(await listMyViews("bob", "reef-zen")).toEqual([]);
    expect(await getConfigValue("theme")).toBe("dark");
  });
});
