// @vitest-environment node

// fake-indexeddb/auto — reconcileAkbAccount reads/writes the Dexie config store
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const clearAuthScopedClientCache = vi.fn();
vi.mock("@/lib/storage/clientCache", () => ({
  clearAuthScopedClientCache: () => clearAuthScopedClientCache(),
}));

import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import {
  getActiveVault,
  getAkbUserId,
  getIssueChangeReviewPeriod,
  getPersistedIssueFilter,
  getConfigValue,
  setActiveVault,
  setAkbUserId,
  setConfigValue,
  setPersistedIssueFilter,
  setIssueChangeReviewPeriod,
} from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { createMyView, listMyViews } from "@/lib/storage/myView";
import {
  getWorkspaceFavorites,
  setWorkspaceFavorites,
} from "@/lib/storage/workspaceFavorites";
import {
  reconcileAkbAccount,
  wipeAkbScopedBrowserState,
} from "./accountReconcile";

describe("reconcileAkbAccount", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
      listOptionalColumns: [],
    });
    await db.config.clear();
  });

  it("records the user id and clears caches on the first login", async () => {
    await reconcileAkbAccount("user-1");

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getAkbUserId()).toBe("user-1");
  });

  it("is a no-op when the same account signs in again", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setWorkspaceFavorites(["reef-acme"]);
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setIssueChangeReviewPeriod("reef-acme", 3);
    await createMyView({
      actor: "user-1",
      vault: "reef-acme",
      name: "Acme personal",
      snapshot: {
        filter: { status: ["todo"] },
        scope: "active",
        layout: "board",
        grouping: "status",
        ordering: { mode: "manual" },
        display: {},
      },
    });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
      listOptionalColumns: ["start"],
    });

    await reconcileAkbAccount("user-1");

    expect(clearAuthScopedClientCache).not.toHaveBeenCalled();
    expect(await getActiveVault()).toBe("reef-acme");
    expect(await getWorkspaceFavorites()).toEqual(["reef-acme"]);
    // Same account: saved filters survive.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
    expect(await getIssueChangeReviewPeriod("reef-acme")).toBe(3);
    expect(await listMyViews("user-1", "reef-acme")).toHaveLength(1);
    // Same account: in-memory filter is left intact.
    expect(useIssueStore.getState().filter).toEqual({ status: ["todo"] });
    expect(useIssueStore.getState().filterVault).toBe("reef-acme");
  });

  it("wipes account-scoped state when a different account signs in", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setWorkspaceFavorites(["reef-acme", "reef-zen"]);
    await setConfigValue("theme", "dark");
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });
    await setIssueChangeReviewPeriod("reef-acme", 3);
    await setIssueChangeReviewPeriod("reef-zen", 14);
    await createMyView({
      actor: "user-1",
      vault: "reef-acme",
      name: "Acme personal",
      snapshot: {
        filter: { status: ["todo"] },
        scope: "active",
        layout: "board",
        grouping: "status",
        ordering: { mode: "manual" },
        display: {},
      },
    });
    await createMyView({
      actor: "user-1",
      vault: "reef-zen",
      name: "Zen personal",
      snapshot: {
        filter: { priority: ["low"] },
        scope: "active",
        layout: "board",
        grouping: "status",
        ordering: { mode: "manual" },
        display: {},
      },
    });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
    });

    await reconcileAkbAccount("user-2");

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getActiveVault()).toBe("");
    expect(await getWorkspaceFavorites()).toEqual([]);
    expect(await getConfigValue("theme")).toBe("dark");
    expect(await getAkbUserId()).toBe("user-2");
    // A different account should not inherit the previous account's saved filters.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
    expect(await getPersistedIssueFilter("reef-zen")).toEqual({});
    expect(await getIssueChangeReviewPeriod("reef-acme")).toBeUndefined();
    expect(await getIssueChangeReviewPeriod("reef-zen")).toBeUndefined();
    expect(await listMyViews("user-1", "reef-acme")).toEqual([]);
    expect(await listMyViews("user-1", "reef-zen")).toEqual([]);
    // ...nor the previous account's in-memory filter (would otherwise leak if
    // the new account reselects the same vault slug).
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().filterVault).toBeNull();
    expect(useIssueStore.getState().searchQuery).toBe("");
    expect(useIssueStore.getState().listOptionalColumns).toEqual([]);
  });
});

describe("wipeAkbScopedBrowserState", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
      listOptionalColumns: [],
    });
    await db.config.clear();
  });

  it("clears the cache, active vault, saved filters, user id, and in-memory filter", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setWorkspaceFavorites(["reef-acme"]);
    await setConfigValue("theme", "dark");
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setIssueChangeReviewPeriod("reef-acme", 7);
    await createMyView({
      actor: "user-1",
      vault: "reef-acme",
      name: "Acme personal",
      snapshot: {
        filter: { status: ["todo"] },
        scope: "active",
        layout: "board",
        grouping: "status",
        ordering: { mode: "manual" },
        display: {},
      },
    });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
      listOptionalColumns: ["release"],
    });

    await wipeAkbScopedBrowserState();

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getActiveVault()).toBe("");
    expect(await getWorkspaceFavorites()).toEqual([]);
    expect(await getConfigValue("theme")).toBe("dark");
    // Unlike a same-account reconcile (a no-op), an explicit sign-out consistently
    // drops the recorded id so the next login is a fresh-account wipe.
    expect(await getAkbUserId()).toBeUndefined();
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
    expect(await getIssueChangeReviewPeriod("reef-acme")).toBeUndefined();
    expect(await listMyViews("user-1", "reef-acme")).toEqual([]);
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().filterVault).toBeNull();
    expect(useIssueStore.getState().listOptionalColumns).toEqual([]);
  });
});
