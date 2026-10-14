import { createQueryWrapper } from "@/test-support/query";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
  return { queryClient, wrapper: createQueryWrapper(queryClient) };
}

const KEY = vaultRosterKey("reef-acme");

afterEach(() => vi.clearAllMocks());

describe("useRevokeMember", () => {
  it("optimistically removes the member and DELETEs the encoded username", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [
      { username: "sam/qa team", role: "writer" },
      { username: "min", role: "reader" },
    ]);
    const response = Promise.withResolvers<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { result } = renderHook(() => useRevokeMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate("sam/qa team");
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(KEY)).toEqual([
        { username: "min", role: "reader" },
      ]),
    );
    expect(result.current.isPending).toBe(true);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/vaults/reef-acme/members/sam%2Fqa%20team",
      expect.objectContaining({ method: "DELETE" }),
    );
    response.resolve(new Response("{}", { status: 200 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(KEY)).toEqual([
      { username: "min", role: "reader" },
    ]);
  });

  it("restores the member when the revoke fails", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const initial = [{ username: "sam", role: "writer" }];
    queryClient.setQueryData(KEY, initial);
    const response = Promise.withResolvers<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { result } = renderHook(() => useRevokeMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate("sam");
    });
    await waitFor(() => expect(queryClient.getQueryData(KEY)).toEqual([]));
    expect(result.current.isPending).toBe(true);
    response.resolve(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual(initial);
  });
});
