import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const pathnameRef = { current: "/workspace/raw-vault/issues" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => pathnameRef.current,
}));

const getAkbSessionStatus = vi.fn();
vi.mock("@/lib/akb/checkAkbSession", () => ({
  getAkbSessionStatus: (signal?: AbortSignal) => getAkbSessionStatus(signal),
}));

const snapshotPendingAkbAccountError = vi.fn();

const accountDeniedHandler = vi.hoisted(() => ({
  current: undefined as
    | ((
        code: "membership_required" | "account_suspended" | "identity_conflict",
      ) => void)
    | undefined,
}));
vi.mock("@/lib/akb/accountDenialClient", () => ({
  snapshotPendingAkbAccountError: () => snapshotPendingAkbAccountError(),
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

import { useAuthRedirect } from "./useAuthRedirect";

describe("useAuthRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/workspace/raw-vault/issues";
    snapshotPendingAkbAccountError.mockReturnValue(undefined);
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
  });

  it("preserves a pending account denial when a plain fallback redirect races", async () => {
    snapshotPendingAkbAccountError.mockReturnValue({
      code: "membership_required",
      token: "denial-token",
    });
    getAkbSessionStatus.mockResolvedValue({ active: false });

    renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?sso_error=membership_required&sso_error_token=denial-token",
      );
    });
  });

  it("preserves an explicit workspace URL through login", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: false });

    renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?redirect=%2Fworkspace%2Fraw-vault%2Fissues",
      );
    });
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
  });

  it("leaves authenticated root workspace selection to the resume policy", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });

    const { result } = renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(result.current).toBe("active");
    });
    expect(replace).not.toHaveBeenCalled();
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

  it("returns to checking immediately when the protected pathname changes", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });
    const { result, rerender } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("active"));
    getAkbSessionStatus.mockImplementation(
      () => new Promise<{ active: boolean }>(() => {}),
    );
    pathnameRef.current = "/workspace/raw-vault/planning";
    rerender();

    expect(result.current).toBe("checking");
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects an active guard when the auth cache/event bridge invalidates it", async () => {
    getAkbSessionStatus.mockResolvedValue({ active: true });
    const { result } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("active"));
    act(() => window.dispatchEvent(new Event("reef:auth-changed")));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?redirect=%2Fworkspace%2Fraw-vault%2Fissues",
      );
    });
  });
});
