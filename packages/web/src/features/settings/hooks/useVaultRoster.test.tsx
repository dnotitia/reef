import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVaultRoster, vaultRosterKey } from "./useVaultRoster";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

describe("useVaultRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the full vault roster and preserves display names", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [
            {
              username: "alice",
              display_name: "Alice Example",
              role: "reader",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useVaultRoster("reef-acme"), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { username: "alice", display_name: "Alice Example", role: "reader" },
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/vaults/reef-acme/members");
  });

  it("revalidates a fresh cached roster on mount", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(vaultRosterKey("reef-acme"), [
      { username: "alice", display_name: "Old Name", role: "reader" },
    ]);
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [
            {
              username: "alice",
              display_name: "New Name",
              role: "reader",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useVaultRoster("reef-acme"), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.data?.[0]?.display_name).toBe("New Name"),
    );
  });
});
