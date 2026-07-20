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

import { apiClient, apiFetch } from "./apiClient";
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
    expect(wipeAkbScopedBrowserState.mock.invocationCallOrder[0]).toBeLessThan(
      recordAkbAccountDenial.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps browser state for an ordinary permission denial", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403));

    await apiClient.fetch("/api/issues");

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
