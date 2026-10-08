import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { SprintRolloverNudge } from "@/features/planning/components/SprintRolloverNudge";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "@/lib/apiClient";
import type { IssueListItem, IssueMetadata, Sprint } from "@reef/core";
import { issueListKey } from "../../lib/issueListCache";
import { useIssueList } from "./useIssueList";

const mockApiFetch = vi.mocked(apiFetch);

const ISSUES: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const ROLLOVER_SPRINT: Sprint = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sprint 14",
  status: "active",
  start_date: "2026-06-01",
  end_date: "2026-06-14",
  goal: "",
  capacity_points: null,
};
const ROLLOVER_ISSUES = [
  {
    ...ISSUES[0],
    sprint_id: ROLLOVER_SPRINT.id,
    archived_at: null,
  },
] as unknown as IssueListItem[];

function IssueListBackedRolloverNudge({ vault }: { vault: string }) {
  const issueQuery = useIssueList(vault);
  const issueState = issueQuery.isError
    ? "error"
    : issueQuery.isPending || !issueQuery.data
      ? "loading"
      : "available";

  return (
    <IntlTestProvider>
      <SprintRolloverNudge
        sprint={ROLLOVER_SPRINT}
        issues={issueQuery.data}
        issueState={issueState}
        now={Date.parse("2026-06-30T00:00:00.000Z")}
        canEdit
        onOpen={vi.fn()}
      />
    </IntlTestProvider>
  );
}

describe("useIssueList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls GET /api/issues?vault={vault} and returns issues array", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: ISSUES }), { status: 200 }),
    );

    const { result } = renderHook(() => useIssueList("reef-acme"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ISSUES);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/issues?vault=reef-acme");
  });

  it("is disabled when vault is empty", () => {
    const { result } = renderHook(() => useIssueList(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("does not start a request when the owning surface is disabled", () => {
    const { result } = renderHook(
      () => useIssueList("reef-acme", undefined, { enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("surfaces isError on non-200 response", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Workspace not found." }), {
        status: 404,
      }),
    );

    const { result } = renderHook(() => useIssueList("reef-acme"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Workspace not found");
  });

  it("refetches an issue failure into a successful empty result", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporary failure" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issues: [] }), { status: 200 }),
      );

    const { result } = renderHook(() => useIssueList("reef-acme"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();

    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a cached rollover notice through a failed refetch and same-data recovery", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporary failure" }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issues: ROLLOVER_ISSUES }), {
          status: 200,
        }),
      );
    queryClient.setQueryData(issueListKey("reef-acme"), ROLLOVER_ISSUES);
    render(
      <QueryClientProvider client={queryClient}>
        <IssueListBackedRolloverNudge vault="reef-acme" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("sprint-rollover-nudge")).toBeVisible(),
    );
    expect(screen.getByTestId("sprint-rollover-nudge")).toHaveTextContent(
      "Sprint 14",
    );
    expect(screen.getByTestId("sprint-rollover-nudge")).toHaveTextContent(
      "1 unfinished issue",
    );

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: issueListKey("reef-acme"),
      });
    });
    const noticeDuringFailure = screen.queryByTestId("sprint-rollover-nudge");
    expect(noticeDuringFailure).toBeVisible();
    expect(queryClient.getQueryState(issueListKey("reef-acme"))?.status).toBe(
      "error",
    );
    expect(queryClient.getQueryData(issueListKey("reef-acme"))).toEqual(
      ROLLOVER_ISSUES,
    );

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: issueListKey("reef-acme"),
      });
    });
    expect(noticeDuringFailure).not.toBeNull();
    expect(screen.getByTestId("sprint-rollover-nudge")).toBeVisible();
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps prior same-vault rows as placeholder by default during a key change", async () => {
    const aliceRows = [{ ...ISSUES[0], id: "REEF-A" }] as IssueMetadata[];
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: aliceRows }), { status: 200 }),
    );
    let resolveSecond: (r: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveSecond = res;
      }),
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: Record<string, string> }) => useIssueList("reef-acme", q),
      {
        wrapper: createWrapper(),
        initialProps: { q: { assigned_to: "alice" } },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(aliceRows));

    rerender({ q: { assigned_to: "bob" } });
    // Same vault, new query key → prior rows stay visible as placeholder.
    expect(result.current.data).toEqual(aliceRows);

    resolveSecond(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("does not reuse a previous vault's rows while the new vault loads", async () => {
    const firstVaultRows = [{ ...ISSUES[0], id: "REEF-FIRST" }];
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: firstVaultRows }), { status: 200 }),
    );
    let resolveSecond: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ vault }: { vault: string }) => useIssueList(vault),
      {
        wrapper: createWrapper(),
        initialProps: { vault: "reef-first" },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(firstVaultRows));

    rerender({ vault: "reef-second" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    const secondVaultRows = [{ ...ISSUES[0], id: "REEF-SECOND" }];
    resolveSecond(
      new Response(JSON.stringify({ issues: secondVaultRows }), {
        status: 200,
      }),
    );
    await waitFor(() => expect(result.current.data).toEqual(secondVaultRows));
  });

  it("drops prior rows (no placeholder) on a key change when keepPreviousData is false (REEF-267)", async () => {
    // The identity-scoped My Work query opts out so an account switch does not
    // reuses the previous login's rows in the same vault.
    const aliceRows = [{ ...ISSUES[0], id: "REEF-A" }] as IssueMetadata[];
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: aliceRows }), { status: 200 }),
    );
    let resolveSecond: (r: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveSecond = res;
      }),
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: Record<string, string> }) =>
        useIssueList("reef-acme", q, { keepPreviousData: false }),
      {
        wrapper: createWrapper(),
        initialProps: { q: { assigned_to: "alice" } },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(aliceRows));

    rerender({ q: { assigned_to: "bob" } });
    // No placeholder: the prior login's rows are NOT shown while bob loads.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    resolveSecond(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
