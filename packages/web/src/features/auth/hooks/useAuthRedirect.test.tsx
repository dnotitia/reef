import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const getAkbSessionStatus = vi.fn();
vi.mock("@/lib/akb/checkAkbSession", () => ({
  getAkbSessionStatus: (signal?: AbortSignal) => getAkbSessionStatus(signal),
}));

const accountDeniedHandler = vi.hoisted(() => ({
  current: undefined as
    | ((
        code: "membership_required" | "account_suspended" | "identity_conflict",
      ) => void)
    | undefined,
}));
vi.mock("@/lib/akb/accountDenialClient", () => ({
  consumePendingAkbAccountError: vi.fn(),
  subscribeAkbAccountDenied: (
    handler: (
      code: "membership_required" | "account_suspended" | "identity_conflict",
    ) => void,
  ) => {
    accountDeniedHandler.current = handler;
    return () => {
      accountDeniedHandler.current = undefined;
    };
  },
}));

const getActiveVault = vi.fn();
vi.mock("@/lib/storage/config", () => ({
  getActiveVault: () => getActiveVault(),
}));

import { useAuthRedirect } from "./useAuthRedirect";

describe("useAuthRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountDeniedHandler.current = undefined;
  });

  it("redirects immediately when a protected request reports an account denial", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });

    renderHook(() => useAuthRedirect("workspace"));
    await waitFor(() => expect(accountDeniedHandler.current).toBeDefined());

    act(() => accountDeniedHandler.current?.("account_suspended"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?sso_error=account_suspended",
      );
    });
  });

  it("routes unauthenticated users to /login", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: false });

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login");
    });
    expect(getActiveVault).not.toHaveBeenCalled();
  });

  it("preserves an AKB account denial when routing to login", async () => {
    getAkbSessionStatus.mockResolvedValue({
      active: false,
      accountError: "membership_required",
    });

    renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?sso_error=membership_required",
      );
    });
    expect(getActiveVault).not.toHaveBeenCalled();
  });

  it("routes authenticated users without an active vault to /onboarding", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });
    getActiveVault.mockResolvedValue("");

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("routes fully onboarded users from root to /issues", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });
    getActiveVault.mockResolvedValue("reef-acme");

    renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/workspace/reef-acme/issues");
    });
  });

  it("does not redirect when an in-flight auth probe is aborted during navigation", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveSession!: (value: { active: boolean }) => void;
    const sessionPromise = new Promise<{ active: boolean }>((resolve) => {
      resolveSession = resolve;
    });
    getAkbSessionStatus.mockImplementation((signal?: AbortSignal) => {
      capturedSignal = signal;
      return sessionPromise;
    });

    const { unmount } = renderHook(() => useAuthRedirect("root"));
    unmount();

    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSession({ active: false });
      await sessionPromise;
    });

    expect(replace).not.toHaveBeenCalled();
  });
});
