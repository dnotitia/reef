import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { __resetAuthCoordinatorForTests } from "@/lib/akb/authCoordinator";
import { useAuthRedirect } from "./useAuthRedirect";

describe("useAuthRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthCoordinatorForTests();
    pathnameRef.current = "/workspace/raw-vault/issues";
    snapshotPendingAkbAccountError.mockReturnValue(undefined);
    accountDeniedHandler.current = undefined;
  });

  afterEach(() => {
    __resetAuthCoordinatorForTests();
  });

  it("redirects immediately when a protected request reports an account denial", async () => {
    getAkbSessionStatus.mockResolvedValue({ state: "active" });

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
    getAkbSessionStatus.mockResolvedValue({ state: "inactive" });

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
    getAkbSessionStatus.mockResolvedValue({ state: "inactive" });

    renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?sso_error=membership_required&sso_error_token=denial-token",
      );
    });
  });

  it("preserves an explicit workspace URL through login", async () => {
    getAkbSessionStatus.mockResolvedValue({ state: "inactive" });

    renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?redirect=%2Fworkspace%2Fraw-vault%2Fissues",
      );
    });
  });

  it("preserves an AKB account denial when routing to login", async () => {
    getAkbSessionStatus.mockResolvedValue({
      state: "inactive",
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
    getAkbSessionStatus.mockResolvedValue({ state: "active" });

    const { result } = renderHook(() => useAuthRedirect("root"));

    await waitFor(() => {
      expect(result.current).toBe("active");
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect when an in-flight auth probe is aborted during navigation", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveSession!: (
      value:
        | { state: "active" }
        | { state: "inactive" }
        | { state: "unavailable" },
    ) => void;
    const sessionPromise = new Promise<
      { state: "active" } | { state: "inactive" } | { state: "unavailable" }
    >((resolve) => {
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
      resolveSession({ state: "inactive" });
      await sessionPromise;
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps an established guard active when the protected pathname changes", async () => {
    getAkbSessionStatus.mockResolvedValue({ state: "active" });
    const { result, rerender } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("active"));
    getAkbSessionStatus.mockClear();
    pathnameRef.current = "/workspace/raw-vault/planning";
    rerender();

    expect(result.current).toBe("active");
    expect(getAkbSessionStatus).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the protected tree active while focus revalidation is pending", async () => {
    getAkbSessionStatus.mockResolvedValueOnce({ state: "active" });
    getAkbSessionStatus.mockImplementationOnce(
      () =>
        new Promise<
          { state: "active" } | { state: "inactive" } | { state: "unavailable" }
        >(() => {}),
    );
    const { result } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("active"));

    act(() => window.dispatchEvent(new Event("focus")));

    expect(result.current).toBe("active");
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects an active guard when the auth cache/event bridge invalidates it", async () => {
    getAkbSessionStatus.mockResolvedValue({ state: "active" });
    const { result } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("active"));
    act(() => window.dispatchEvent(new Event("reef:auth-changed")));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?redirect=%2Fworkspace%2Fraw-vault%2Fissues",
      );
    });
  });

  it("keeps an unavailable probe on the current route without redirecting", async () => {
    getAkbSessionStatus.mockResolvedValue({ state: "unavailable" });

    const { result } = renderHook(() => useAuthRedirect("workspace"));

    await waitFor(() => expect(result.current).toBe("unavailable"));
    expect(replace).not.toHaveBeenCalled();
  });
});
