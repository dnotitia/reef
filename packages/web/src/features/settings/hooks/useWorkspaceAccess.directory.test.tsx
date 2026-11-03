import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test-support/query";

vi.mock("@/features/auth/hooks/useCurrentUser", () => ({
  CURRENT_USER_QUERY_KEY: ["auth", "me"],
  useCurrentUser: () => ({
    data: { is_admin: false },
    isSuccess: true,
    isError: false,
  }),
}));
vi.mock("@/lib/apiClient", async () => ({
  ...(await vi.importActual<typeof import("@/lib/apiClient")>(
    "@/lib/apiClient",
  )),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/apiClient";
import { useWorkspaceAccess } from "./useWorkspaceAccess";

describe("workspace role discovery", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses the active directory role without requesting management inventory", async () => {
    const fetch = vi.mocked(apiFetch);
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vaults: [
            { name: "reef-acme", role: "writer", installation_active: true },
          ],
        }),
      ),
    );
    const { result } = renderHook(() => useWorkspaceAccess("reef-acme"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.role).toBe("writer"));
    expect(result.current.canEditWorkspace).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/vaults");
  });

  it("loads management roles only when the selected workspace is inactive", async () => {
    const fetch = vi.mocked(apiFetch);
    fetch.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            vaults:
              url === "/api/vaults"
                ? []
                : [
                    {
                      name: "reef-acme",
                      role: "owner",
                      installation_active: false,
                    },
                  ],
          }),
        ),
    );
    const { result } = renderHook(() => useWorkspaceAccess("reef-acme"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.role).toBe("owner"));
    expect(result.current.canEditWorkspace).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/vaults",
      "/api/vaults?scope=management",
    ]);
  });
});
