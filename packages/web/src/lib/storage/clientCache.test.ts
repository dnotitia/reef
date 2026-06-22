// fake-indexeddb/auto should be imported first so the credentials helpers
// can talk to a fresh in-memory Dexie instance under jsdom.
import "fake-indexeddb/auto";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AUTH_CHANGED_EVENT,
  __resetAuthChannelForTests,
  clearAuthScopedClientCache,
  subscribeCrossTabAuthChange,
} from "./clientCache";
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

/**
 * Deterministic, synchronous stand-in for the platform BroadcastChannel so the
 * cross-tab tests can model two tabs in one process. Real-channel semantics:
 * postMessage delivers to other open instances of the same name, not
 * back to the sender.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  posted: unknown[] = [];
  closed = false;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error("channel is closed");
    this.posted.push(data);
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      other.deliver(data);
    }
  }

  addEventListener(type: "message", handler: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.add(handler);
  }

  removeEventListener(type: "message", handler: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  /** Test helper: deliver a message as if it came from another tab. */
  private deliver(data: unknown): void {
    if (this.closed) return;
    const event = new MessageEvent("message", { data });
    for (const handler of this.listeners) handler(event);
  }
}

type BroadcastChannelGlobal = { BroadcastChannel?: unknown };

describe("cross-tab auth propagation", () => {
  let originalBroadcastChannel: unknown;

  beforeEach(() => {
    originalBroadcastChannel = (globalThis as BroadcastChannelGlobal)
      .BroadcastChannel;
    FakeBroadcastChannel.instances = [];
    (globalThis as BroadcastChannelGlobal).BroadcastChannel =
      FakeBroadcastChannel;
    __resetAuthChannelForTests();
  });

  afterEach(() => {
    __resetAuthChannelForTests();
    FakeBroadcastChannel.instances = [];
    (globalThis as BroadcastChannelGlobal).BroadcastChannel =
      originalBroadcastChannel;
  });

  it("clearAuthScopedClientCache broadcasts AUTH_CHANGED_EVENT on the reef:auth channel", () => {
    clearAuthScopedClientCache();

    const channel = FakeBroadcastChannel.instances.find(
      (c) => c.name === "reef:auth",
    );
    expect(channel).toBeDefined();
    expect(channel?.posted).toContain(AUTH_CHANGED_EVENT);
  });

  it("re-dispatches AUTH_CHANGED_EVENT locally when a sibling tab signs out", () => {
    const windowHandler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, windowHandler);
    const unsubscribe = subscribeCrossTabAuthChange();

    // Another tab's clearAuthScopedClientCache posts on its own channel.
    const siblingTab = new FakeBroadcastChannel("reef:auth");
    siblingTab.postMessage(AUTH_CHANGED_EVENT);

    expect(windowHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(AUTH_CHANGED_EVENT, windowHandler);
  });

  it("ignores cross-tab messages that are not AUTH_CHANGED_EVENT", () => {
    const windowHandler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, windowHandler);
    const unsubscribe = subscribeCrossTabAuthChange();

    const siblingTab = new FakeBroadcastChannel("reef:auth");
    siblingTab.postMessage("reef:something-else");

    expect(windowHandler).not.toHaveBeenCalled();

    unsubscribe();
    window.removeEventListener(AUTH_CHANGED_EVENT, windowHandler);
  });

  it("stops re-dispatching after unsubscribe", () => {
    const windowHandler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, windowHandler);
    const unsubscribe = subscribeCrossTabAuthChange();
    unsubscribe();

    const siblingTab = new FakeBroadcastChannel("reef:auth");
    siblingTab.postMessage(AUTH_CHANGED_EVENT);

    expect(windowHandler).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_CHANGED_EVENT, windowHandler);
  });

  it("does not re-process the broadcasting tab's own message", () => {
    // The singleton instance is both sender and receiver; a real
    // BroadcastChannel does not echo a message to its own sender, so the
    // signing-out tab fires its window handler exactly once (the direct
    // dispatch), not twice via the channel.
    const unsubscribe = subscribeCrossTabAuthChange();
    const windowHandler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, windowHandler);

    clearAuthScopedClientCache();

    expect(windowHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(AUTH_CHANGED_EVENT, windowHandler);
  });

  it("subscribeCrossTabAuthChange is a no-op when BroadcastChannel is unavailable", () => {
    __resetAuthChannelForTests();
    (globalThis as BroadcastChannelGlobal).BroadcastChannel = undefined;

    const windowHandler = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, windowHandler);
    const unsubscribe = subscribeCrossTabAuthChange();

    expect(typeof unsubscribe).toBe("function");
    // Single-tab dispatch still works even with no cross-tab channel.
    clearAuthScopedClientCache();
    expect(windowHandler).toHaveBeenCalledTimes(1);
    expect(() => unsubscribe()).not.toThrow();

    window.removeEventListener(AUTH_CHANGED_EVENT, windowHandler);
  });
});

// Close any channel singleton created by the tests above so it does not keep a
// platform BroadcastChannel handle open past the suite.
afterAll(() => {
  __resetAuthChannelForTests();
});
