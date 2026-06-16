// fake-indexeddb/auto should be imported first so the credentials helpers
// can talk to a fresh in-memory Dexie instance under jsdom.
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGED_EVENT, clearAuthScopedClientCache } from "./clientCache";
import {
  clearGitHubToken,
  getGitHubToken,
  setGitHubToken,
} from "./credentials";
import { db } from "./db";

const QUERY_CACHE_LS_KEY = "REACT_QUERY_OFFLINE_CACHE";

beforeEach(async () => {
  window.localStorage.clear();
  await db.credentials.clear();
});

afterEach(async () => {
  await db.credentials.clear();
  window.localStorage.clear();
});

describe("clearAuthScopedClientCache", () => {
  it("removes the persisted query snapshot and every reef:etag:* key", () => {
    window.localStorage.setItem(QUERY_CACHE_LS_KEY, "{}");
    window.localStorage.setItem("reef:etag:repos:list", 'W/"a"');
    window.localStorage.setItem("reef:etag:older:list", 'W/"b"');
    // Unrelated keys should survive so we don't blow away non-auth state.
    window.localStorage.setItem("reef:other:keep-me", "untouched");

    clearAuthScopedClientCache();

    expect(window.localStorage.getItem(QUERY_CACHE_LS_KEY)).toBeNull();
    expect(window.localStorage.getItem("reef:etag:repos:list")).toBeNull();
    expect(window.localStorage.getItem("reef:etag:older:list")).toBeNull();
    expect(window.localStorage.getItem("reef:other:keep-me")).toBe("untouched");
  });

  it("dispatches AUTH_CHANGED_EVENT so the in-memory QueryClient can react", () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, handler);

    clearAuthScopedClientCache();

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  });
});

describe("credentials → cache invalidation", () => {
  it("clearGitHubToken wipes the auth-scoped cache", async () => {
    await setGitHubToken("ghp_a");
    window.localStorage.setItem(QUERY_CACHE_LS_KEY, '{"clientState":"prev"}');
    window.localStorage.setItem("reef:etag:repos:list", 'W/"prev"');
    const handler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, handler);

    await clearGitHubToken();

    expect(window.localStorage.getItem(QUERY_CACHE_LS_KEY)).toBeNull();
    expect(window.localStorage.getItem("reef:etag:repos:list")).toBeNull();
    expect(handler).toHaveBeenCalled();
    expect(await getGitHubToken()).toBeUndefined();
    window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  });

  it("setGitHubToken wipes the cache when the token differs from the previous value", async () => {
    await setGitHubToken("ghp_a");
    window.localStorage.setItem(QUERY_CACHE_LS_KEY, '{"clientState":"prev"}');
    window.localStorage.setItem("reef:etag:repos:list", 'W/"prev"');
    const handler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, handler);

    await setGitHubToken("ghp_b");

    expect(window.localStorage.getItem(QUERY_CACHE_LS_KEY)).toBeNull();
    expect(window.localStorage.getItem("reef:etag:repos:list")).toBeNull();
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  });

  it("setGitHubToken with the SAME value preserves the cache (no wipe)", async () => {
    await setGitHubToken("ghp_a");
    window.localStorage.setItem(QUERY_CACHE_LS_KEY, '{"clientState":"keep"}');
    window.localStorage.setItem("reef:etag:repos:list", 'W/"keep"');
    const handler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, handler);

    // Idempotent re-save (e.g. OAuth callback hitting the same token) should
    // not invalidate the cache or cost a refetch.
    await setGitHubToken("ghp_a");

    expect(window.localStorage.getItem(QUERY_CACHE_LS_KEY)).toBe(
      '{"clientState":"keep"}',
    );
    expect(window.localStorage.getItem("reef:etag:repos:list")).toBe(
      'W/"keep"',
    );
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  });

  it("setGitHubToken from a blank slate (first login) wipes any leftover cache", async () => {
    // Defensive case: dev wiped Dexie but localStorage still has cached
    // queries from a previous build. First-time setGitHubToken should clean
    // those up so the new session starts on fresh data.
    window.localStorage.setItem(QUERY_CACHE_LS_KEY, '{"clientState":"stale"}');
    window.localStorage.setItem("reef:etag:repos:list", 'W/"stale"');

    await setGitHubToken("ghp_first");

    expect(window.localStorage.getItem(QUERY_CACHE_LS_KEY)).toBeNull();
    expect(window.localStorage.getItem("reef:etag:repos:list")).toBeNull();
  });
});
