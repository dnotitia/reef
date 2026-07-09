// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllIssueFilters,
  clearPersistedIssueFilter,
  getConfigValue,
  getPersistedIssueFilter,
  setConfigValue,
  setPersistedIssueFilter,
} from "./config";
import { db } from "./db";

describe("persisted issue filter (config helpers)", () => {
  beforeEach(async () => {
    await db.config.clear();
  });
  afterEach(async () => {
    await db.config.clear();
  });

  it("round-trips filter + sort fields", async () => {
    await setPersistedIssueFilter("reef-acme", {
      status: ["todo"],
      priority: ["high"],
      label: "ui,risk",
      sortField: "updated_at",
      sortOrder: "desc",
    });
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
      priority: ["high"],
      label: "ui,risk",
      sortField: "updated_at",
      sortOrder: "desc",
    });
  });

  it("uses the canonical `filter:{vault}` key, wrapped in a version envelope", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    const raw = await getConfigValue("filter:reef-acme");
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string)).toEqual({
      version: 1,
      filter: { status: ["todo"] },
    });
  });

  it("scopes filters per vault — distinct vaults are independent", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
    expect(await getPersistedIssueFilter("reef-zen")).toEqual({
      priority: ["low"],
    });
  });

  it("returns {} when nothing is stored", async () => {
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
  });

  it("returns {} for an empty vault", async () => {
    expect(await getPersistedIssueFilter("")).toEqual({});
  });

  it("returns {} on corrupt JSON", async () => {
    await setConfigValue("filter:reef-acme", "{not json");
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
  });

  it("returns {} on a version mismatch (hard discard)", async () => {
    await setConfigValue(
      "filter:reef-acme",
      JSON.stringify({ version: 99, filter: { status: "todo" } }),
    );
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
  });

  it("drops invalid fields but keeps valid siblings on read (AC5)", async () => {
    await setConfigValue(
      "filter:reef-acme",
      JSON.stringify({
        version: 1,
        filter: { status: ["archived"], priority: ["high"], foo: "bar" },
      }),
    );
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      priority: ["high"],
    });
  });

  it("restores a older single-scalar saved filter as an array (REEF-031 old-shape)", async () => {
    // A pre-REEF-031 release wrote facets as single strings under the same
    // version 1 envelope; the upgrade should widen them, not discard them.
    await setConfigValue(
      "filter:reef-acme",
      JSON.stringify({
        version: 1,
        filter: { status: "todo", priority: "high", sortField: "due_date" },
      }),
    );
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
      priority: ["high"],
      sortField: "due_date",
    });
  });

  it("does not persist searchQuery-style or unknown keys passed through the store filter", async () => {
    // The store filter can carry a retired `search` field; the schema strips
    // anything not in the persisted shape on the way to disk.
    const withExtra = { status: ["todo"], search: "auth" } as Parameters<
      typeof setPersistedIssueFilter
    >[1];
    await setPersistedIssueFilter("reef-acme", withExtra);
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
  });

  it("clears a single vault's slot", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await clearPersistedIssueFilter("reef-acme");
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
  });

  it("clearAllIssueFilters deletes every filter:* key but leaves other config", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });
    await setConfigValue("theme", "dark");
    await setConfigValue("vault", "reef-acme");

    await clearAllIssueFilters();

    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
    expect(await getPersistedIssueFilter("reef-zen")).toEqual({});
    expect(await getConfigValue("theme")).toBe("dark");
    expect(await getConfigValue("vault")).toBe("reef-acme");
  });

  it("throws TypeError when setting with a missing vault", async () => {
    await expect(
      setPersistedIssueFilter("", { status: ["todo"] }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
