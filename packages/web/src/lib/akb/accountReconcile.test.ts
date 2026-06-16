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
  getActivityRepo,
  getAkbUserId,
  getConfigValue,
  getPersistedIssueFilter,
  setActiveVault,
  setActivityRepo,
  setAkbUserId,
  setConfigValue,
  setPersistedIssueFilter,
} from "@/lib/storage/config";
import { getGitHubToken, setGitHubToken } from "@/lib/storage/credentials";
import { db } from "@/lib/storage/db";
import { getLastScanAt, setLastScanAt } from "@/lib/storage/lastScan";
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
    });
    await Promise.all([db.config.clear(), db.credentials.clear()]);
  });

  it("records the user id and clears caches on the first login", async () => {
    await reconcileAkbAccount("user-1");

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getAkbUserId()).toBe("user-1");
  });

  it("is a no-op when the same account signs in again", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
    });

    await reconcileAkbAccount("user-1");

    expect(clearAuthScopedClientCache).not.toHaveBeenCalled();
    expect(await getActiveVault()).toBe("reef-acme");
    // Same account: saved filters survive.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({
      status: ["todo"],
    });
    // Same account: in-memory filter is left intact.
    expect(useIssueStore.getState().filter).toEqual({ status: ["todo"] });
    expect(useIssueStore.getState().filterVault).toBe("reef-acme");
  });

  it("wipes account-scoped state when a different account signs in", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    await setPersistedIssueFilter("reef-zen", { priority: ["low"] });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
    });

    await reconcileAkbAccount("user-2");

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getActiveVault()).toBe("");
    expect(await getAkbUserId()).toBe("user-2");
    // A different account should not inherit the previous account's saved filters.
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
    expect(await getPersistedIssueFilter("reef-zen")).toEqual({});
    // ...nor the previous account's in-memory filter (would otherwise leak if
    // the new account reselects the same vault slug).
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().filterVault).toBeNull();
    expect(useIssueStore.getState().searchQuery).toBe("");
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
    });
    await Promise.all([db.config.clear(), db.credentials.clear()]);
  });

  it("clears the cache, active vault, saved filters, user id, and in-memory filter", async () => {
    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "auth",
      selectedIssueId: null,
    });

    await wipeAkbScopedBrowserState();

    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
    expect(await getActiveVault()).toBe("");
    // Unlike a same-account reconcile (a no-op), an explicit sign-out consistently
    // drops the recorded id so the next login is a fresh-account wipe.
    expect(await getAkbUserId()).toBeUndefined();
    expect(await getPersistedIssueFilter("reef-acme")).toEqual({});
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().filterVault).toBeNull();
  });

  it("clears activity scan repo, read marker, and scan watermarks, but keeps the device theme", async () => {
    await setActivityRepo("reef-acme", "octo/cat");
    await setConfigValue("last_visit_at", "2026-06-01T00:00:00Z");
    await setLastScanAt("octo/cat", "2026-06-02T00:00:00Z");
    // theme is device-scoped, not account-scoped — it should survive the wipe.
    await setConfigValue("theme", "dark");

    await wipeAkbScopedBrowserState();

    expect(await getActivityRepo("reef-acme")).toBeUndefined();
    expect(await getConfigValue("last_visit_at")).toBeUndefined();
    expect(await getLastScanAt("octo/cat")).toBeUndefined();
    expect(await getConfigValue("theme")).toBe("dark");
  });

  it("preserves the GitHub PAT while clearing akb-scoped browser state", async () => {
    await setGitHubToken("ghp_test");
    clearAuthScopedClientCache.mockClear();

    await setAkbUserId("user-1");
    await setActiveVault("reef-acme");

    await wipeAkbScopedBrowserState();

    expect(await getGitHubToken()).toBe("ghp_test");
    expect(await getAkbUserId()).toBeUndefined();
    expect(await getActiveVault()).toBe("");
    expect(clearAuthScopedClientCache).toHaveBeenCalledOnce();
  });
});
