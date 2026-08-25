// @vitest-environment node

// fake-indexeddb/auto should be imported first — before any Dexie/db imports
import "fake-indexeddb/auto";

import {
  type Mock,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const wipeAkbScopedBrowserState = vi.hoisted(() => vi.fn());
const recordAkbAccountDenial = vi.hoisted(() => vi.fn());

vi.mock("./akb/accountReconcile", () => ({
  wipeAkbScopedBrowserState: () => wipeAkbScopedBrowserState(),
}));
vi.mock("./akb/accountDenialClient", () => ({
  recordAkbAccountDenial: (code: string) => recordAkbAccountDenial(code),
}));

import {
  apiClient,
  apiFetch,
  abortAuthScopedRequests,
  classifyAuthResponse,
} from "./apiClient";
import {
  __resetAuthCoordinatorForTests,
  bootstrapAuthSession,
  getAuthCoordinatorSnapshot,
} from "./akb/authCoordinator";
import { setConfigValue } from "./storage/config";
import { db } from "./storage/db";

// Mock global fetch to avoid real network calls
const mockFetch = vi.fn<typeof fetch>();

function mockResponse(status = 200, body = "{}"): Response {
  return new Response(body, { status });
}

describe("apiClient.fetch — browser request headers", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetch);
    await db.config.clear();
    mockFetch.mockReset();
    wipeAkbScopedBrowserState.mockReset();
    recordAkbAccountDenial.mockReset();
    mockFetch.mockResolvedValue(mockResponse());
  });

  afterEach(async () => {
    __resetAuthCoordinatorForTests();
    await db.config.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not attach Authorization from browser state", async () => {
    await apiClient.fetch("/api/issues?repo=owner/repo");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("preserves existing headers without adding Authorization", async () => {
    await apiClient.fetch("/api/issues?repo=owner/repo", {
      headers: { "Content-Type": "application/json" },
    });

    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("exposes `apiFetch` as a bound alias of `apiClient.fetch`", async () => {
    // Destructure to assert `this`-binding is preserved even when detached.
    const detached = apiFetch;
    await detached("/api/issues");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("wipes AKB-scoped browser state when the server invalidates auth", async () => {
    const response = new Response("{}", {
      status: 403,
      headers: { "X-Reef-Auth-Invalidated": "1" },
    });
    mockFetch.mockResolvedValueOnce(response);

    await expect(apiClient.fetch("/api/issues")).resolves.toBe(response);

    expect(wipeAkbScopedBrowserState).toHaveBeenCalledOnce();
  });

  it("propagates a stable account denial after clearing browser state", async () => {
    const response = new Response("{}", {
      status: 403,
      headers: {
        "X-Reef-Auth-Invalidated": "1",
        "X-Reef-Account-Error": "membership_required",
      },
    });
    mockFetch.mockResolvedValueOnce(response);

    await apiClient.fetch("/api/issues");

    expect(wipeAkbScopedBrowserState).toHaveBeenCalledOnce();
    expect(recordAkbAccountDenial).toHaveBeenCalledWith("membership_required");
    expect(recordAkbAccountDenial.mock.invocationCallOrder[0]).toBeLessThan(
      wipeAkbScopedBrowserState.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps browser state for an ordinary permission denial", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403));

    await apiClient.fetch("/api/issues");

    expect(wipeAkbScopedBrowserState).not.toHaveBeenCalled();
  });

  it("does not sign out on a first-visit plain 401", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401));

    await apiClient.fetch("/api/auth/akb/me");

    expect(wipeAkbScopedBrowserState).not.toHaveBeenCalled();
  });

  it("does not invalidate an established session on a status-only 401", async () => {
    bootstrapAuthSession(async () => ({ active: true }));
    await vi.waitFor(() =>
      expect(getAuthCoordinatorSnapshot().status).toBe("active"),
    );

    mockFetch.mockResolvedValueOnce(mockResponse(401));

    await apiClient.fetch("/api/issues");

    expect(getAuthCoordinatorSnapshot().status).toBe("active");
    expect(wipeAkbScopedBrowserState).not.toHaveBeenCalled();
  });

  it("preserves the account-denial response when browser cleanup fails", async () => {
    const response = new Response("{}", {
      status: 403,
      headers: { "X-Reef-Auth-Invalidated": "1" },
    });
    mockFetch.mockResolvedValueOnce(response);
    wipeAkbScopedBrowserState.mockRejectedValueOnce(
      new Error("IndexedDB unavailable"),
    );

    await expect(apiClient.fetch("/api/issues")).resolves.toBe(response);
  });

  it("classifies first-visit 401 and resource 403 without conflating them", () => {
    expect(classifyAuthResponse(mockResponse(401), false)).toBe(
      "first-visit-unauthenticated",
    );
    expect(classifyAuthResponse(mockResponse(401), true)).toBe("other-error");
    expect(classifyAuthResponse(mockResponse(403), true)).toBe(
      "resource-permission-denial",
    );
    expect(
      classifyAuthResponse(
        new Response("{}", {
          status: 401,
          headers: { "X-Reef-Auth-Invalidated": "1" },
        }),
        false,
      ),
    ).toBe("established-session-invalidation");
    expect(classifyAuthResponse(mockResponse(500), true)).toBe("other-error");
  });

  it("aborts an in-flight protected request on auth invalidation", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    mockFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    );

    const request = apiClient.fetch("/api/issues");
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    abortAuthScopedRequests();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("apiClient.fetch — deployment-managed LLM", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetch);
    await db.config.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse());
  });

  afterEach(async () => {
    await db.config.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not attach X-Reef-LLM even when older LLM values are stored", async () => {
    await setConfigValue("llm_base_url", "https://api.openai.com/v1");
    await setConfigValue("llm_model", "gpt-4o");

    await apiClient.fetch("/api/agents/runs");

    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Reef-LLM")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("preserves caller headers while omitting deployment-managed secret headers", async () => {
    await setConfigValue("llm_base_url", "https://api.openai.com/v1");
    await setConfigValue("llm_model", "gpt-4o");

    await apiClient.fetch("/api/agents/runs", {
      headers: { "Content-Type": "application/json" },
    });

    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Reef-LLM")).toBeNull();
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("apiClient.fetch — X-Reef-Vault (REEF-315)", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetch);
    await db.config.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse());
  });

  afterEach(async () => {
    await db.config.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("attaches the Dexie default vault when the caller provides none", async () => {
    await setConfigValue("vault", "reef-dexie");

    await apiClient.fetch("/api/agents/runs");

    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(new Headers(init.headers).get("X-Reef-Vault")).toBe("reef-dexie");
  });

  it("respects a caller-provided X-Reef-Vault over the Dexie default (tab-local context)", async () => {
    // Two tabs share the Dexie pointer; the task-scoped caller
    // sets its own workspace and the shared default should not clobber it.
    await setConfigValue("vault", "reef-dexie");

    await apiClient.fetch("/api/agents/runs", {
      headers: { "X-Reef-Vault": "reef-url" },
    });

    const [, init] = (mockFetch as Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(new Headers(init.headers).get("X-Reef-Vault")).toBe("reef-url");
  });
});
