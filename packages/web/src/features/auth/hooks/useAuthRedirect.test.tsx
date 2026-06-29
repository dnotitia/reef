import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const hasActiveAkbSession = vi.fn();
vi.mock("@/lib/akb/checkAkbSession", () => ({
  hasActiveAkbSession: (signal?: AbortSignal) => hasActiveAkbSession(signal),
}));

const getActiveVault = vi.fn();
vi.mock("@/lib/storage/config", () => ({
  getActiveVault: () => getActiveVault(),
}));

import { useAuthRedirect } from "./useAuthRedirect";

describe("useAuthRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes unauthenticated users to /login", async () => {
    hasActiveAkbSession.mockResolvedValue(false);

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login");
    });
    expect(getActiveVault).not.toHaveBeenCalled();
  });

  it("routes authenticated users without an active vault to /onboarding", async () => {
    hasActiveAkbSession.mockResolvedValue(true);
    getActiveVault.mockResolvedValue("");

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("routes fully onboarded users from root to /issues", async () => {
    hasActiveAkbSession.mockResolvedValue(true);
    getActiveVault.mockResolvedValue("reef-acme");

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/workspace/reef-acme/issues");
    });
  });

  it("does not redirect when an in-flight auth probe is aborted during navigation", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveSession!: (value: boolean) => void;
    const sessionPromise = new Promise<boolean>((resolve) => {
      resolveSession = resolve;
    });
    hasActiveAkbSession.mockImplementation((signal?: AbortSignal) => {
      capturedSignal = signal;
      return sessionPromise;
    });

    const { unmount } = renderHook(() => useAuthRedirect("root"));
    unmount();

    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSession(false);
      await sessionPromise;
    });

    expect(replace).not.toHaveBeenCalled();
  });
});
