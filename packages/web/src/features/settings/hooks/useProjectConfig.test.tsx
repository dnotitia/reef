import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: vi.fn(),
}));

import { useUpdateProjectConfig } from "./useProjectConfig";

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useUpdateProjectConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("primes and invalidates the vault config query after a successful patch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const config = {
      project_prefix: "REEF",
      monitored_repos: [{ github_id: 1001, owner: "octo", name: "reef" }],
      authoring_language: null,
    };
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ config }), { status: 200 }),
    );

    const { result } = renderHook(() => useUpdateProjectConfig("reef-e2e"), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        patch: { monitored_repos: config.monitored_repos },
      });
    });

    expect(queryClient.getQueryData(["config", "reef-e2e"])).toEqual({
      config,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["config", "reef-e2e"],
    });
  });
});
