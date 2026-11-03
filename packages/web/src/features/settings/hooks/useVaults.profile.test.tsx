import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test-support/query";

vi.mock("@/lib/apiClient", async () => ({
  ...(await vi.importActual<typeof import("@/lib/apiClient")>(
    "@/lib/apiClient",
  )),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/apiClient";
import { useVaults } from "./useVaults";

describe("workspace directory profile failures", () => {
  it.each([
    [false, "unavailable"],
    [true, "unavailable"],
    [false, "malformed"],
    [true, "malformed"],
  ] as const)(
    "stops after profile failure and recovers explicitly (admin: %s, failure: %s)",
    async (isAdmin, failure) => {
      let healthy = false;
      let profiles = 0;
      const fetch = vi.mocked(apiFetch);
      fetch.mockReset();
      fetch.mockImplementation(async (input) => {
        if (String(input) === "/api/auth/akb/me") {
          profiles++;
          if (profiles > 5 && !healthy) return new Promise<Response>(() => {});
          return healthy
            ? Response.json({ username: "alice", is_admin: isAdmin })
            : failure === "malformed"
              ? new Response("{", { status: 200 })
              : new Response(null, { status: 503 });
        }
        return Response.json({
          vaults: [{ name: "reef", role: "writer", installation_active: true }],
        });
      });
      let renders = 0;
      const { result } = renderHook(
        () => {
          renders++;
          return {
            directory: useVaults(),
            management: useVaults({ management: true, enabled: false }),
          };
        },
        { wrapper: createQueryWrapper() },
      );
      await waitFor(() => expect(profiles).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(profiles).toBe(1);
      expect(result.current.directory.isError).toBe(true);
      const settledRenders = renders;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(renders).toBe(settledRenders);
      expect(
        fetch.mock.calls.filter(([url]) =>
          String(url).startsWith("/api/vaults"),
        ),
      ).toHaveLength(0);
      await act(async () => {
        await result.current.directory.refetch();
      });
      expect(profiles).toBe(2);
      expect(result.current.directory.isError).toBe(true);
      healthy = true;
      await act(async () => {
        await result.current.directory.refetch();
      });
      await waitFor(() =>
        expect(result.current.directory.data?.[0]?.name).toBe("reef"),
      );
      expect(fetch).toHaveBeenCalledWith(
        isAdmin ? "/api/vaults?scope=admin" : "/api/vaults",
      );
      expect(
        fetch.mock.calls.filter(([url]) =>
          String(url).startsWith("/api/vaults"),
        ),
      ).toHaveLength(1);
    },
  );
});
