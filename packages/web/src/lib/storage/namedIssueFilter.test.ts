// @vitest-environment node

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfigValue, setConfigValue } from "./config";
import { db } from "./db";
import {
  NamedIssueFilterDuplicateError,
  clearAllNamedIssueFilters,
  createNamedIssueFilter,
  deleteNamedIssueFilter,
  listNamedIssueFilters,
  namedIssueFilterStorageKey,
  updateNamedIssueFilter,
} from "./namedIssueFilter";

describe("named issue filter storage", () => {
  beforeEach(async () => {
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
    vi.restoreAllMocks();
  });

  it("round-trips a versioned item in a vault-scoped stable-id key", async () => {
    const item = await createNamedIssueFilter({
      vault: "reef-acme",
      name: "  Ａｃｔｉｖｅ  ",
      payload: {
        status: ["todo", "todo"],
        sortField: "due_date",
      },
    });

    expect(item.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
    expect(item.name).toBe("Active");
    expect(item.nameKey).toBe("active");
    expect(item.payload).toEqual({
      status: ["todo"],
      sortField: "due_date",
      sortOrder: "asc",
    });
    expect(await listNamedIssueFilters("reef-acme")).toEqual([item]);
    expect(
      await getConfigValue(namedIssueFilterStorageKey("reef-acme", item.id)),
    ).toContain('"version":1');
  });

  it("keeps vault key spaces independent", async () => {
    await createNamedIssueFilter({
      vault: "reef-acme",
      name: "Shared name",
      payload: { status: ["todo"] },
    });
    await createNamedIssueFilter({
      vault: "reef-zen",
      name: "Shared name",
      payload: { priority: ["high"] },
    });

    expect(
      (await listNamedIssueFilters("reef-acme")).map((item) => item.name),
    ).toEqual(["Shared name"]);
    expect(
      (await listNamedIssueFilters("reef-zen")).map((item) => item.name),
    ).toEqual(["Shared name"]);
  });

  it("rejects duplicate names without overwriting the existing item", async () => {
    const original = await createNamedIssueFilter({
      vault: "reef-acme",
      name: "Active",
      payload: { status: ["todo"] },
    });

    await expect(
      createNamedIssueFilter({
        vault: "reef-acme",
        name: "  ａｃｔｉｖｅ ",
        payload: { priority: ["high"] },
      }),
    ).rejects.toBeInstanceOf(NamedIssueFilterDuplicateError);
    expect(await listNamedIssueFilters("reef-acme")).toEqual([original]);
  });

  it("rejects duplicate renames without changing either item", async () => {
    const first = await createNamedIssueFilter({
      vault: "reef-acme",
      name: "First",
      payload: { status: ["todo"] },
    });
    const second = await createNamedIssueFilter({
      vault: "reef-acme",
      name: "Second",
      payload: { priority: ["high"] },
    });

    await expect(
      updateNamedIssueFilter({
        vault: "reef-acme",
        id: second.id,
        name: " first ",
      }),
    ).rejects.toBeInstanceOf(NamedIssueFilterDuplicateError);
    expect(await listNamedIssueFilters("reef-acme")).toEqual(
      expect.arrayContaining([first, second]),
    );
  });

  it("sanitizes invalid persisted fields and marks an empty payload unappliable", async () => {
    await setConfigValue(
      namedIssueFilterStorageKey("reef-acme", "invalid-fields"),
      JSON.stringify({
        version: 1,
        id: "invalid-fields",
        name: "Needs cleanup",
        nameKey: "wrong",
        payload: {
          status: ["removed-status", "todo", ""],
          priority: ["not-a-priority", "high"],
          sortOrder: "desc",
        },
      }),
    );
    await setConfigValue(
      namedIssueFilterStorageKey("reef-acme", "empty-payload"),
      JSON.stringify({
        version: 1,
        id: "empty-payload",
        name: "Empty payload",
        nameKey: "empty payload",
        payload: { sortOrder: "asc", showArchived: false },
      }),
    );

    const items = await listNamedIssueFilters("reef-acme");
    expect(items.find((item) => item.id === "invalid-fields")).toMatchObject({
      nameKey: "needs cleanup",
      payload: { status: ["todo"], priority: ["high"] },
      applicable: true,
    });
    expect(items.find((item) => item.id === "empty-payload")).toMatchObject({
      payload: {},
      applicable: false,
    });
  });

  it("does not report success or leave an item when a write fails", async () => {
    vi.spyOn(db.config, "add").mockRejectedValueOnce(new Error("write failed"));

    await expect(
      createNamedIssueFilter({
        vault: "reef-acme",
        name: "Failed write",
        payload: { status: ["todo"] },
      }),
    ).rejects.toThrow("write failed");
    expect(await listNamedIssueFilters("reef-acme")).toEqual([]);
  });

  it("deletes only the requested item and clears all vaults for reconciliation", async () => {
    const acme = await createNamedIssueFilter({
      vault: "reef-acme",
      name: "Acme",
      payload: { status: ["todo"] },
    });
    await createNamedIssueFilter({
      vault: "reef-zen",
      name: "Zen",
      payload: { priority: ["high"] },
    });

    await deleteNamedIssueFilter({ vault: "reef-acme", id: acme.id });
    expect(await listNamedIssueFilters("reef-acme")).toEqual([]);
    expect(await listNamedIssueFilters("reef-zen")).toHaveLength(1);

    await clearAllNamedIssueFilters();
    expect(await listNamedIssueFilters("reef-zen")).toEqual([]);
  });
});
