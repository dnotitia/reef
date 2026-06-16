// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/lib/akb/accountReconcile", () => ({
  wipeAkbScopedBrowserState: vi.fn(),
}));

import { wipeAkbScopedBrowserState } from "@/lib/akb/accountReconcile";
import { apiFetch } from "@/lib/apiClient";
import { signOutOfWorkspace } from "./signOut.actions";

const mockApiFetch = vi.mocked(apiFetch);
const mockWipe = vi.mocked(wipeAkbScopedBrowserState);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signOutOfWorkspace", () => {
  it("POSTs logout, then wipes akb-scoped browser state", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(signOutOfWorkspace()).resolves.toEqual({});

    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/akb/logout", {
      method: "POST",
    });
    expect(mockWipe).toHaveBeenCalledOnce();
  });

  it("returns a safe SSO logout redirect URL after local cleanup", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ redirectUrl: "/api/auth/akb/sso/logout" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(signOutOfWorkspace()).resolves.toEqual({
      redirectUrl: "/api/auth/akb/sso/logout",
    });
    expect(mockWipe).toHaveBeenCalledOnce();
  });

  it("drops unsafe redirect URLs from the logout response", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ redirectUrl: "https://evil.test" }), {
        status: 200,
      }),
    );

    await expect(signOutOfWorkspace()).resolves.toEqual({});
    expect(mockWipe).toHaveBeenCalledOnce();
  });

  it("does not wipe local state when the logout request fails", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(signOutOfWorkspace()).rejects.toThrow();
    expect(mockWipe).not.toHaveBeenCalled();
  });

  it("propagates a network rejection without wiping", async () => {
    mockApiFetch.mockRejectedValue(new Error("network down"));

    await expect(signOutOfWorkspace()).rejects.toThrow("network down");
    expect(mockWipe).not.toHaveBeenCalled();
  });
});
