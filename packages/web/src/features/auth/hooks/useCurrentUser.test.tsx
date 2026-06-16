import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { useCurrentUser } from "./useCurrentUser";

const mockApiFetch = vi.mocked(apiFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCurrentUser", () => {
  it("returns the stripped display profile on 200", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "u1",
          username: "alice",
          display_name: "Alice Example",
          email: "alice@example.com",
          is_admin: false,
          auth_method: "password",
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Strip drops akb passthrough fields (is_admin, auth_method).
    expect(result.current.data).toEqual({
      user_id: "u1",
      username: "alice",
      display_name: "Alice Example",
      email: "alice@example.com",
    });
  });

  it("maps 401 to a null (logged-out) profile rather than an error", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 401 }));

    const { result } = renderHook(() => useCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("surfaces a non-401 failure as an error", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 500 }));

    const { result } = renderHook(() => useCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
