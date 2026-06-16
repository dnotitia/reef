import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "@/lib/apiClient";
import type { EnrichedVaultSummary } from "@reef/core";
import { useVaults } from "./useVaults";

const mockApiFetch = vi.mocked(apiFetch);

const VAULTS: EnrichedVaultSummary[] = [
  {
    name: "reef-acme",
    description: null,
    status: "active",
    role: "owner",
    created_at: "2026-05-01T00:00:00.000Z",
    has_reef_config: true,
  },
];

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

describe("useVaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls GET /api/vaults and returns the vault list", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ vaults: VAULTS }), { status: 200 }),
    );

    const { result } = renderHook(() => useVaults(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(VAULTS);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/vaults");
  });

  it("surfaces 401 as isError", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Your session has expired." }), {
        status: 401,
      }),
    );

    const { result } = renderHook(() => useVaults(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("surfaces a Zod parse error when response shape is malformed", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ vaults: [{ wrong: "shape" }] }), {
        status: 200,
      }),
    );

    const { result } = renderHook(() => useVaults(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("rejects payloads missing has_reef_config (wire contract)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vaults: [
            {
              name: "reef-acme",
              description: null,
              status: "active",
              role: "owner",
              created_at: "2026-05-01T00:00:00.000Z",
              // has_reef_config intentionally omitted
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useVaults(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
