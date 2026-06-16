import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

vi.mock("@/lib/storage/lastScan", () => ({
  getLastScanAt: vi.fn().mockResolvedValue(undefined),
  setLastScanAt: vi.fn().mockResolvedValue(undefined),
  shouldAutoScan: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/features/settings/hooks/useProjectConfig", () => ({
  ensureProjectConfig: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useAiAvailable", () => ({
  useAiAvailable: () => ({ isAvailable: true }),
}));

// Auto-trigger is gated on a configured GitHub token (REEF-159). Default to
// "token present"; the token-missing test flips this.
const tokenState = vi.hoisted(() => ({
  current: { hasToken: true, isLoading: false },
}));
vi.mock("@/features/settings/hooks/useHasGithubToken", () => ({
  useHasGithubToken: () => tokenState.current,
}));

const { toastSuccess, toastInfo, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(toastInfo, {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));

import { ensureProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { apiFetch } from "@/lib/apiClient";
import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import {
  getLastScanAt,
  setLastScanAt,
  shouldAutoScan,
} from "@/lib/storage/lastScan";
import { useScanActivity, useScanAutoTrigger } from "./useScanActivity";

const mockApiFetch = vi.mocked(apiFetch);
const mockSetLastScanAt = vi.mocked(setLastScanAt);
const mockGetLastScanAt = vi.mocked(getLastScanAt);
const mockShouldAutoScan = vi.mocked(shouldAutoScan);
const mockEnsureProjectConfig = vi.mocked(ensureProjectConfig);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const SCAN_RESPONSE = {
  addedDrafts: 1,
  addedStatusChanges: 1,
  scannedAt: "2026-05-08T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenState.current = { hasToken: true, isLoading: false };
  mockGetLastScanAt.mockResolvedValue(undefined);
  mockShouldAutoScan.mockResolvedValue(true);
  mockEnsureProjectConfig.mockResolvedValue({
    config: { project_prefix: "REEF" },
  } as Awaited<ReturnType<typeof ensureProjectConfig>>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useScanActivity", () => {
  it("POSTs to /api/activity/scan and records the returned scan watermark", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify(SCAN_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        vault: "reef-acme",
        repo: "octo/cat",
        source: "manual",
      });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/activity/scan");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      owner: "octo",
      repo: "cat",
      vault: "reef-acme",
      projectPrefix: "REEF",
    });
    expect(body).not.toHaveProperty("dismissedRefs");

    expect(mockSetLastScanAt).toHaveBeenCalledWith(
      "octo/cat",
      "2026-05-08T10:00:00.000Z",
    );
  });

  it("throws MissingCredentialsError on 401 (auto path stays silent)", async () => {
    mockApiFetch.mockResolvedValue(new Response("", { status: 401 }));

    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        vault: "reef-acme",
        repo: "octo/cat",
        source: "auto",
      }),
    ).rejects.toThrow(/Reconnect GitHub/);

    // Auto failures stay silent — no toast.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("rejects with a helpful message when the repo string is malformed", async () => {
    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        vault: "reef-acme",
        repo: "no-slash",
        source: "manual",
      }),
    ).rejects.toThrow(/Invalid repo/);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("rejects when vault is empty", async () => {
    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        vault: "",
        repo: "octo/cat",
        source: "manual",
      }),
    ).rejects.toThrow(/Missing vault/);
  });

  it("manual: toasts the combined count on success", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          addedDrafts: 2,
          addedStatusChanges: 3,
          scannedAt: "2026-05-08T10:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        vault: "reef-acme",
        repo: "octo/cat",
        source: "manual",
      });
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("2 drafts"),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("3 status changes"),
    );
  });

  it("manual: toasts a 'no new activity' message when nothing was added", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          addedDrafts: 0,
          addedStatusChanges: 0,
          scannedAt: "2026-05-08T10:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useScanActivity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        vault: "reef-acme",
        repo: "octo/cat",
        source: "manual",
      });
    });

    expect(toastInfo).toHaveBeenCalledWith(
      expect.stringContaining("No new activity"),
    );
  });
});

describe("useScanAutoTrigger", () => {
  it("fires mutate when AI is available and cooldown allows", async () => {
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("reef-acme", "octo/cat", mutate));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith({
      vault: "reef-acme",
      repo: "octo/cat",
      source: "auto",
    });
  });

  it("skips when shouldAutoScan returns false (cooldown not elapsed)", async () => {
    mockShouldAutoScan.mockResolvedValueOnce(false);
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("reef-acme", "octo/cat", mutate));
    // Give the async IIFE time to resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("short-circuits when vault is empty", async () => {
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("", "octo/cat", mutate));
    await new Promise((r) => setTimeout(r, 10));
    expect(mutate).not.toHaveBeenCalled();
    expect(mockShouldAutoScan).not.toHaveBeenCalled();
  });

  it("short-circuits when repo is empty", async () => {
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("reef-acme", "", mutate));
    await new Promise((r) => setTimeout(r, 10));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not fire when no GitHub token is configured (REEF-159)", async () => {
    // repo + AI + cooldown all green, but the workspace has no GitHub token:
    // the scan route would 401, so the auto-trigger should stay silent.
    tokenState.current = { hasToken: false, isLoading: false };
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("reef-acme", "octo/cat", mutate));
    await new Promise((r) => setTimeout(r, 10));
    expect(mutate).not.toHaveBeenCalled();
    expect(mockShouldAutoScan).not.toHaveBeenCalled();
  });

  it("re-arms on AUTH_CHANGED_EVENT so a replaced token resumes the scan (REEF-159)", async () => {
    // An invalid token has presence (hasToken stays true), so it fires once and
    // 401s. Replacing it broadcasts AUTH_CHANGED_EVENT — without re-arming, the
    // fired-key guard would suppress the retry and the scan would does not resume
    // until a remount.
    const mutate = vi.fn();
    renderHook(() => useScanAutoTrigger("reef-acme", "octo/cat", mutate));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    });

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  });
});
