import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch, mockGetDefault, mockClearDefault } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockGetDefault: vi.fn(),
  mockClearDefault: vi.fn(),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: mockApiFetch };
});

vi.mock("@/lib/storage/config", () => ({
  getDefaultIssueViewId: mockGetDefault,
  clearDefaultIssueViewId: mockClearDefault,
}));

import type { SavedIssueView } from "@reef/core";
import { savedIssueViewsKey } from "../queries/useSavedIssueViews";
import {
  useCreateSavedIssueView,
  useDeleteSavedIssueView,
  useUpdateSavedIssueView,
} from "./useSavedIssueViewMutations";

const view = (id: string, name: string): SavedIssueView => ({
  id,
  name,
  name_key: name.toLowerCase(),
  owner: "alice",
  payload: { version: 1, query: { status: ["todo"] } },
});
const acmeId = "11111111-1111-4111-8111-111111111111";
const zenId = "22222222-2222-4222-8222-222222222222";

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  queryClient.setQueryData(savedIssueViewsKey("reef-acme"), [
    view(acmeId, "Acme"),
  ]);
  queryClient.setQueryData(savedIssueViewsKey("reef-zen"), [
    view(zenId, "Zen"),
  ]);
  return { queryClient, wrapper };
}

describe("saved-view mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefault.mockResolvedValue(undefined);
  });

  it("updates and sorts only the exact vault cache after create", async () => {
    const created = view("33333333-3333-4333-8333-333333333333", "Aardvark");
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ view: created }), { status: 201 }),
    );
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useCreateSavedIssueView("reef-acme"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: created.name,
        payload: created.payload,
      });
    });

    expect(
      queryClient
        .getQueryData<SavedIssueView[]>(savedIssueViewsKey("reef-acme"))
        ?.map((item) => item.name),
    ).toEqual(["Aardvark", "Acme"]);
    expect(queryClient.getQueryData(savedIssueViewsKey("reef-zen"))).toEqual([
      view(zenId, "Zen"),
    ]);
  });

  it("leaves every cache unchanged when an update fails", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Duplicate" }), { status: 409 }),
    );
    const { queryClient, wrapper } = harness();
    const before = queryClient.getQueryData(savedIssueViewsKey("reef-acme"));
    const { result } = renderHook(() => useUpdateSavedIssueView("reef-acme"), {
      wrapper,
    });

    await act(async () => {
      await result.current
        .mutateAsync({ id: acmeId, patch: { name: "Zen" } })
        .catch(() => undefined);
    });

    expect(queryClient.getQueryData(savedIssueViewsKey("reef-acme"))).toEqual(
      before,
    );
    expect(queryClient.getQueryData(savedIssueViewsKey("reef-zen"))).toEqual([
      view(zenId, "Zen"),
    ]);
  });

  it("removes only the exact row and clears its matching default pointer", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }));
    mockGetDefault.mockResolvedValue(acmeId);
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useDeleteSavedIssueView("reef-acme"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(acmeId);
    });

    expect(queryClient.getQueryData(savedIssueViewsKey("reef-acme"))).toEqual(
      [],
    );
    expect(queryClient.getQueryData(savedIssueViewsKey("reef-zen"))).toEqual([
      view(zenId, "Zen"),
    ]);
    expect(mockClearDefault).toHaveBeenCalledWith("reef-acme");
  });
});
