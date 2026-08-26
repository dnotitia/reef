// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceFavorites,
  compareWorkspaceNames,
  filterWorkspaceFavorites,
  getConfiguredWorkspaceNames,
  getWorkspaceFavorites,
  WORKSPACE_FAVORITES_STORAGE_KEY,
  setWorkspaceFavorites,
} from "./workspaceFavorites";
import { getConfigValue, setConfigValue } from "./config";
import { db } from "./db";

const CANDIDATES = [
  { name: "reef-zeta", has_reef_config: true },
  { name: "reef-alpha", has_reef_config: true },
  { name: "reef-alpha", has_reef_config: true },
  { name: "raw-vault", has_reef_config: false },
  { name: "Bad Vault", has_reef_config: true },
] as const;

describe("workspace favorites storage", () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.config.clear();
  });

  afterEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.config.clear();
  });

  it("round-trips a versioned envelope with only valid unique names", async () => {
    await setWorkspaceFavorites([
      "reef-zeta",
      "reef-alpha",
      "reef-alpha",
      "raw-vault",
      "Bad Vault",
    ]);

    expect(await getWorkspaceFavorites()).toEqual([
      "raw-vault",
      "reef-alpha",
      "reef-zeta",
    ]);
    expect(
      JSON.parse(
        (await getConfigValue(WORKSPACE_FAVORITES_STORAGE_KEY)) as string,
      ),
    ).toEqual({
      version: 1,
      favorites: ["raw-vault", "reef-alpha", "reef-zeta"],
    });
  });

  it("repairs duplicate and malformed names on a supported envelope", async () => {
    await setConfigValue(
      WORKSPACE_FAVORITES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        favorites: ["reef-zeta", "Bad Vault", "reef-alpha", "reef-zeta"],
      }),
    );

    expect(await getWorkspaceFavorites()).toEqual(["reef-alpha", "reef-zeta"]);
    expect(
      JSON.parse(
        (await getConfigValue(WORKSPACE_FAVORITES_STORAGE_KEY)) as string,
      ).favorites,
    ).toEqual(["reef-alpha", "reef-zeta"]);
  });

  it("filters raw, invalid, duplicate, and stale entries against configured candidates", async () => {
    const available = getConfiguredWorkspaceNames(CANDIDATES);
    expect(available).toEqual(["reef-alpha", "reef-zeta"]);
    expect(
      filterWorkspaceFavorites(
        ["reef-zeta", "raw-vault", "reef-missing", "Bad Vault", "reef-zeta"],
        available,
      ),
    ).toEqual(["reef-zeta"]);
  });

  it("uses the original name as the deterministic tie-break after case folding", () => {
    expect(
      ["beta", "Alpha", "alpha", "Beta"].toSorted(compareWorkspaceNames),
    ).toEqual(["Alpha", "alpha", "Beta", "beta"]);
  });

  it("degrades corrupt JSON and unknown envelope versions to empty favorites", async () => {
    await setConfigValue(WORKSPACE_FAVORITES_STORAGE_KEY, "{not json");
    expect(await getWorkspaceFavorites()).toEqual([]);

    await setConfigValue(
      WORKSPACE_FAVORITES_STORAGE_KEY,
      JSON.stringify({ version: 99, favorites: ["reef-alpha"] }),
    );
    expect(await getWorkspaceFavorites()).toEqual([]);
  });

  it("degrades closed IndexedDB without blocking reads, writes, or cleanup", async () => {
    await setWorkspaceFavorites(["reef-alpha"]);
    db.close();

    await expect(getWorkspaceFavorites()).resolves.toEqual([]);
    await expect(setWorkspaceFavorites(["reef-zeta"])).resolves.toBeUndefined();
    await expect(clearWorkspaceFavorites()).resolves.toBeUndefined();
  });

  it("clears favorites while preserving the device theme", async () => {
    await setWorkspaceFavorites(["reef-alpha"]);
    await setConfigValue("theme", "dark");

    await clearWorkspaceFavorites();

    expect(await getWorkspaceFavorites()).toEqual([]);
    expect(await getConfigValue("theme")).toBe("dark");
  });
});
