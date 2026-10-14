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

import { useGrantMember } from "./useGrantMember";
import { vaultRosterKey } from "./useVaultRoster";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { queryClient, wrapper: createQueryWrapper(queryClient) };
}

const OK = { ok: true, json: async () => ({}) } as Response;
const KEY = vaultRosterKey("reef-acme");

afterEach(() => vi.clearAllMocks());

describe("useGrantMember", () => {
  it("optimistically inserts a brand-new member", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [{ username: "alice", role: "owner" }]);
    const response = Promise.withResolvers<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { result } = renderHook(() => useGrantMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate({
        user: "carol",
        role: "writer",
        displayName: "Carol",
      });
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(KEY)).toEqual([
        { username: "alice", role: "owner" },
        { username: "carol", role: "writer", display_name: "Carol" },
      ]),
    );
    expect(result.current.isPending).toBe(true);
    response.resolve(OK);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(KEY)).toEqual([
      { username: "alice", role: "owner" },
      { username: "carol", role: "writer", display_name: "Carol" },
    ]);
  });

  it("optimistically patches an existing member's role (upsert = role change)", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [
      { username: "sam", role: "writer", display_name: "Sam" },
    ]);
    const response = Promise.withResolvers<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { result } = renderHook(() => useGrantMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate({ user: "sam", role: "admin" });
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(KEY)).toEqual([
        { username: "sam", role: "admin", display_name: "Sam" },
      ]),
    );
    expect(result.current.isPending).toBe(true);
    response.resolve(OK);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(KEY)).toEqual([
      { username: "sam", role: "admin", display_name: "Sam" },
    ]);
  });

  it("rolls the roster back when the grant fails", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const initial = [{ username: "sam", role: "writer", display_name: "Sam" }];
    queryClient.setQueryData(KEY, initial);
    const response = Promise.withResolvers<Response>();
    mockApiFetch.mockReturnValue(response.promise);

    const { result } = renderHook(() => useGrantMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate({ user: "sam", role: "admin" });
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(KEY)).toEqual([
        { username: "sam", role: "admin", display_name: "Sam" },
      ]),
    );
    expect(result.current.isPending).toBe(true);
    response.resolve(
      new Response(JSON.stringify({ error: "Requires admin" }), {
        status: 403,
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual(initial);
  });
});
