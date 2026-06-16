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

import { useGrantMember } from "./useGrantMember";
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

const OK = { ok: true, json: async () => ({}) } as Response;
const KEY = vaultRosterKey("reef-acme");

afterEach(() => vi.clearAllMocks());

describe("useGrantMember", () => {
  it("optimistically inserts a brand-new member", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [{ username: "alice", role: "owner" }]);
    mockApiFetch.mockResolvedValue(OK);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(KEY)).toContainEqual({
      username: "carol",
      role: "writer",
      display_name: "Carol",
    });
  });

  it("optimistically patches an existing member's role (upsert = role change)", async () => {
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(KEY, [
      { username: "sam", role: "writer", display_name: "Sam" },
    ]);
    mockApiFetch.mockResolvedValue(OK);

    const { result } = renderHook(() => useGrantMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate({ user: "sam", role: "admin" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual([
      { username: "sam", role: "admin", display_name: "Sam" },
    ]);
  });

  it("rolls the roster back when the grant fails", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const initial = [{ username: "sam", role: "writer", display_name: "Sam" }];
    queryClient.setQueryData(KEY, initial);
    mockApiFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Requires admin" }),
    } as Response);

    const { result } = renderHook(() => useGrantMember("reef-acme"), {
      wrapper,
    });
    act(() => {
      result.current.mutate({ user: "sam", role: "admin" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(KEY)).toEqual(initial);
  });
});
