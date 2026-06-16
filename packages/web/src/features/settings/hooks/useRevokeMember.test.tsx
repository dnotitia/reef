import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: mockApiFetch };
});

import { useRevokeMember } from "./useRevokeMember";
import { vaultRosterKey } from "./useVaultRoster";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const KEY = vaultRosterKey("reef-acme");

afterEach(() => vi.clearAllMocks());

describe("useRevokeMember", () => {
  it("optimistically removes the member and DELETEs the encoded username", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [
      { username: "sam", role: "writer" },
      { username: "min", role: "reader" },
    ]);
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const { result } = renderHook(() => useRevokeMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate("sam");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual([
      { username: "min", role: "reader" },
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/vaults/reef-acme/members/sam",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("restores the member when the revoke fails", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const initial = [{ username: "sam", role: "writer" }];
    queryClient.setQueryData(KEY, initial);
    mockApiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);

    const { result } = renderHook(() => useRevokeMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate("sam");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual(initial);
  });
});
