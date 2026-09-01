import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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

const { mockRememberRecentAssigneeLogin } = vi.hoisted(() => ({
  mockRememberRecentAssigneeLogin: vi.fn(),
}));

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => "alice",
}));

vi.mock("@/lib/storage/assigneeRecents", () => ({
  assigneeRecentsQueryKey: (actor: string | null, vault: string) => [
    "assignee-recents",
    actor,
    vault,
  ],
  rememberRecentAssigneeLogin: mockRememberRecentAssigneeLogin,
}));

import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { issueBodyHistoryKey } from "../queries/useIssueBodyHistory";
import {
  hasPendingIssueUpdate,
  useIssueUpdateState,
  useUpdateIssue,
} from "./useUpdateIssue";

const mockApiFetch = vi.mocked(apiFetch);

const ORIGINAL: IssueMetadata = {
  id: "REEF-001",
  title: "Sample",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

const UPDATED: IssueMetadata = {
  id: "REEF-001",
  title: "Sample",
  status: "in_progress",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-02T00:00:00.000Z",
  updated_by: "alice",
};

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderUseUpdateIssue(
  queryClient = makeTestQueryClient(),
  options?: Parameters<typeof useUpdateIssue>[0],
) {
  return {
    queryClient,
    ...renderHook(() => useUpdateIssue(options), {
      wrapper: makeWrapper(queryClient),
    }),
  };
}

describe("useUpdateIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRememberRecentAssigneeLogin.mockResolvedValue(["bob"]);
  });

  it("PATCHes /api/issues/{id} with { vault, update }", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "## body" }), {
        status: 200,
      }),
    );
    const { result } = renderUseUpdateIssue();

    let returned: { issue: IssueMetadata; content: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/issues/REEF-001");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      vault: "reef-acme",
      update: {
        issue_id: "REEF-001",
        patch: { status: "in_progress" },
      },
    });
    expect(returned).toEqual({
      issue: UPDATED,
      content: "## body",
    });
  });

  it("records a successful non-null assigned_to in the actor/vault recent cache", async () => {
    mockApiFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
          status: 200,
        }),
    );
    const queryClient = makeTestQueryClient();
    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { assigned_to: "bob" },
      });
    });

    expect(mockRememberRecentAssigneeLogin).toHaveBeenCalledWith(
      "alice",
      "reef-acme",
      "bob",
    );
    expect(
      queryClient.getQueryData(["assignee-recents", "alice", "reef-acme"]),
    ).toEqual(["bob"]);
  });

  it("does not record clears, unrelated patches, or failed saves", async () => {
    mockApiFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
          status: 200,
        }),
    );
    const { result } = renderUseUpdateIssue();

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { assigned_to: null },
      });
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { title: "Renamed" },
      });
    });
    mockApiFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "REEF-001",
          vault: "reef-acme",
          patch: { assigned_to: "carol" },
        }),
      ).rejects.toThrow();
    });

    expect(mockRememberRecentAssigneeLogin).not.toHaveBeenCalled();
  });

  it("includes content in body when provided", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "new" }), {
        status: 200,
      }),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: {},
        content: "new",
      });
    });

    expect(JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string)).toEqual(
      {
        vault: "reef-acme",
        update: {
          issue_id: "REEF-001",
          patch: {},
          content: "new",
        },
      },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: issueBodyHistoryKey("reef-acme", "REEF-001"),
    });
  });

  it("omits content key from body when undefined", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
        status: 200,
      }),
    );
    const { result } = renderUseUpdateIssue();

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string);
    expect(body).not.toHaveProperty("content");
  });

  it("refetches list + relations on a membership/status edit, never detail", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
        status: 200,
      }),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });

    // `status` is both a server facet and a relation-graph field, so both
    // projections refetch to reconcile membership/order and blocker state. The
    // list refetch is now narrowed to a predicate (REEF-323) instead of a
    // blanket key match.
    const listCall = invalidateSpy.mock.calls.find(
      (call) => call[0]?.queryKey?.[1] === "list",
    );
    expect(listCall?.[0]).toMatchObject({
      queryKey: ["issues", "list", "reef-acme"],
      predicate: expect.any(Function),
    });
    // The narrowed predicate skips the bare full list but refetches a
    // status-filtered variant (the changed facet).
    const listPredicate = listCall?.[0]?.predicate as unknown as
      | ((q: { queryKey: readonly unknown[] }) => boolean)
      | undefined;
    expect(listPredicate?.({ queryKey: ["issues", "list", "reef-acme"] })).toBe(
      false,
    );
    expect(
      listPredicate?.({
        queryKey: [
          "issues",
          "list",
          "reef-acme",
          { status: ["todo"], sort_field: "created_at" },
        ],
      }),
    ).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "relations", "reef-acme"],
    });
    // A status change logs a reef_activity event, so the timeline's activity
    // query refetches to show the transition immediately (REEF-064).
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "activity", "reef-acme", "REEF-001"],
    });
    // The detail cache is overwritten with the server response (above), so it
    // avoids blanket invalidation (REEF-098).
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["issues", "detail", "reef-acme", "REEF-001"],
    });
  });

  it("defers list and relation reconciliation for bulk callers but keeps activity fresh", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
        status: 200,
      }),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderUseUpdateIssue(queryClient, {
      reconciliation: "deferred",
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["issues", "list", "reef-acme"] }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["issues", "relations", "reef-acme"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "activity", "reef-acme", "REEF-001"],
    });
  });

  it("does not refetch the plain list on a non-membership edit (REEF-098)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issue: { ...UPDATED, title: "Renamed" },
          content: "",
        }),
        { status: 200 },
      ),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { title: "Renamed" },
      });
    });

    // A title edit is patched in place. The plain list is not blanket
    // refetched, and the relation graph is untouched. (Active q-filtered
    // variants are reconciled, via a predicate — none exist here.)
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["issues", "list", "reef-acme"],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["issues", "relations", "reef-acme"],
    });
    // A title edit logs a `title_change` activity event (REEF-277), so the
    // timeline's activity query refetches to surface it immediately — the same
    // immediate-update path status changes use (REEF-064), now covering the
    // whole field-change set, not just `status`.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "activity", "reef-acme", "REEF-001"],
    });
  });

  it("refetches order-sensitive list variants on a non-membership edit (REEF-325)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issue: { ...UPDATED, title: "Renamed" },
          content: "",
        }),
        { status: 200 },
      ),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { title: "Renamed" },
      });
    });

    // One order-aware predicate now covers non-membership edits too (REEF-325):
    // a title edit reorders an `updated_at`-sorted variant (every edit restamps
    // `updated_at` server-side) and a title-sorted variant, while an unrelated
    // created_at-sorted facet variant stays patched in place.
    const listCall = invalidateSpy.mock.calls.find(
      (call) => call[0]?.queryKey?.[1] === "list",
    );
    const predicate = listCall?.[0]?.predicate as unknown as
      | ((q: { queryKey: readonly unknown[] }) => boolean)
      | undefined;
    expect(
      predicate?.({
        queryKey: ["issues", "list", "reef-acme", { sort_field: "updated_at" }],
      }),
    ).toBe(true);
    expect(
      predicate?.({
        queryKey: ["issues", "list", "reef-acme", { sort_field: "title" }],
      }),
    ).toBe(true);
    expect(
      predicate?.({
        queryKey: [
          "issues",
          "list",
          "reef-acme",
          { status: ["todo"], sort_field: "created_at" },
        ],
      }),
    ).toBe(false);
    // The bare full list stays patched in place; the mutation response supplies
    // its server-backed values (REEF-098).
    expect(predicate?.({ queryKey: ["issues", "list", "reef-acme"] })).toBe(
      false,
    );
  });

  it("does not refetch the activity timeline on an edit that logs no event", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issue: { ...UPDATED, reporter: "bob" },
          content: "",
        }),
        { status: 200 },
      ),
    );
    const queryClient = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { reporter: "bob" },
      });
    });

    // `reporter` is not one of the dimensions `diffFieldActivityEvents` records,
    // so the edit appends no `reef_activity` row and the timeline stays patched
    // in place — no refetch (REEF-064/REEF-098).
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["issues", "activity", "reef-acme", "REEF-001"],
    });
  });

  it("optimistically updates cached list and detail while the request is pending", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );

    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["issues", "list", "reef-acme"], [ORIGINAL]);
    queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
      issue: ORIGINAL,
      content: "old body",
    });

    const { result } = renderUseUpdateIssue(queryClient);

    act(() => {
      result.current.mutate({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
        content: "new body",
      });
    });

    await waitFor(() => {
      const list = queryClient.getQueryData<IssueMetadata[]>([
        "issues",
        "list",
        "reef-acme",
      ]);
      expect(list?.[0]?.status).toBe("in_progress");
    });

    const detail = queryClient.getQueryData<{
      issue: IssueMetadata;
      content: string;
    }>(["issues", "detail", "reef-acme", "REEF-001"]);
    expect(detail?.issue.status).toBe("in_progress");
    expect(detail?.content).toBe("new body");

    await act(async () => {
      resolveResponse(
        new Response(JSON.stringify({ issue: UPDATED, content: "new body" }), {
          status: 200,
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back optimistic cache updates on failure", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Save conflict." }), {
        status: 409,
      }),
    );
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["issues", "list", "reef-acme"], [ORIGINAL]);
    queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
      issue: ORIGINAL,
      content: "old body",
    });

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current
        .mutateAsync({
          id: "REEF-001",
          vault: "reef-acme",
          patch: { status: "in_progress" },
          content: "new body",
        })
        .catch(() => {});
    });

    const list = queryClient.getQueryData<IssueMetadata[]>([
      "issues",
      "list",
      "reef-acme",
    ]);
    const detail = queryClient.getQueryData<{
      issue: IssueMetadata;
      content: string;
    }>(["issues", "detail", "reef-acme", "REEF-001"]);

    expect(list?.[0]).toEqual(ORIGINAL);
    expect(detail).toEqual({ issue: ORIGINAL, content: "old body" });
  });

  it("rolls back only the failed issue when sibling updates are pending", async () => {
    const issueA = { ...ORIGINAL, id: "REEF-001" };
    const issueB = { ...ORIGINAL, id: "REEF-002" };
    const pendingResponses = new Map<string, (response: Response) => void>();
    mockApiFetch.mockImplementation((url) => {
      const id = String(url).split("/").pop() ?? "";
      return new Promise<Response>((resolve) => {
        pendingResponses.set(id, resolve);
      });
    });

    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["issues", "list", "reef-acme"], [issueA, issueB]);
    const { result } = renderUseUpdateIssue(queryClient);

    act(() => {
      result.current.mutate({
        id: issueA.id,
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
      result.current.mutate({
        id: issueB.id,
        vault: "reef-acme",
        patch: { status: "done" },
      });
    });

    await waitFor(() => {
      const list = queryClient.getQueryData<(typeof ORIGINAL)[]>([
        "issues",
        "list",
        "reef-acme",
      ]);
      expect(list?.map((issue) => issue.status)).toEqual([
        "in_progress",
        "done",
      ]);
    });

    await act(async () => {
      pendingResponses.get(issueA.id)?.(
        new Response(JSON.stringify({ error: "failed" }), { status: 500 }),
      );
    });
    await waitFor(() => {
      const list = queryClient.getQueryData<(typeof ORIGINAL)[]>([
        "issues",
        "list",
        "reef-acme",
      ]);
      expect(list?.map((issue) => issue.status)).toEqual(["todo", "done"]);
    });

    await act(async () => {
      pendingResponses.get(issueB.id)?.(
        new Response(
          JSON.stringify({
            issue: { ...issueB, status: "done" },
            content: "",
          }),
          { status: 200 },
        ),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("exposes pending and settled mutation state per vault, issue, and changed fields", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const queryClient = makeTestQueryClient();
    const update = renderUseUpdateIssue(queryClient);
    const status = renderHook(
      () => useIssueUpdateState("reef-acme", "REEF-001"),
      { wrapper: makeWrapper(queryClient) },
    );
    const sibling = renderHook(
      () => useIssueUpdateState("reef-acme", "REEF-002"),
      { wrapper: makeWrapper(queryClient) },
    );

    act(() => {
      update.result.current.mutate({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });
    await waitFor(() => expect(status.result.current.status).toBe("pending"));
    expect(status.result.current.fields).toEqual(["status"]);
    expect(sibling.result.current.status).toBe("idle");
    expect(sibling.result.current.fields).toEqual([]);

    await act(async () => {
      resolveResponse(
        new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
          status: 200,
        }),
      );
    });
    await waitFor(() => expect(status.result.current.status).toBe("success"));
    expect(status.result.current.fields).toEqual(["status"]);
    expect(sibling.result.current.status).toBe("idle");
  });

  it("isolates the pending guard by vault and issue for non-status fields", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const queryClient = makeTestQueryClient();
    const { result } = renderUseUpdateIssue(queryClient);

    act(() => {
      result.current.mutate({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { labels: ["quick-edit"] },
      });
    });

    await waitFor(() =>
      expect(hasPendingIssueUpdate(queryClient, "reef-acme", "REEF-001")).toBe(
        true,
      ),
    );
    expect(hasPendingIssueUpdate(queryClient, "reef-acme", "REEF-002")).toBe(
      false,
    );
    expect(hasPendingIssueUpdate(queryClient, "reef-other", "REEF-001")).toBe(
      false,
    );

    await act(async () => {
      resolveResponse(
        new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
          status: 200,
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hasPendingIssueUpdate(queryClient, "reef-acme", "REEF-001")).toBe(
      false,
    );
  });

  it("notifies callers with the restored detail snapshot after a failure", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Save failed." }), {
        status: 500,
      }),
    );
    const queryClient = makeTestQueryClient();
    const previousDetail = {
      issue: { ...ORIGINAL, assigned_to: "alice" },
      content: "old body",
    };
    queryClient.setQueryData(
      ["issues", "detail", "reef-acme", "REEF-001"],
      previousDetail,
    );
    const onError = vi.fn();
    const { result } = renderUseUpdateIssue(queryClient, { onError });

    await act(async () => {
      await result.current
        .mutateAsync({
          id: "REEF-001",
          vault: "reef-acme",
          patch: { assigned_to: "bob" },
        })
        .catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { assigned_to: "bob" },
      }),
      { previousDetail },
    );
    expect(
      queryClient.getQueryData<typeof previousDetail>([
        "issues",
        "detail",
        "reef-acme",
        "REEF-001",
      ])?.issue.assigned_to,
    ).toBe("alice");
  });

  it("sends expected_commit from the cached detail commit_hash (REEF-227)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ issue: UPDATED, content: "new", commit_hash: "c2" }),
        { status: 200 },
      ),
    );
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
      issue: ORIGINAL,
      content: "old",
      commit_hash: "c1",
    });

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: {},
        content: "new",
      });
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.update.expected_commit).toBe("c1");
  });

  it("omits expected_commit when the detail cache has no base commit", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: UPDATED, content: "" }), {
        status: 200,
      }),
    );
    const queryClient = makeTestQueryClient();
    // No detail cache seeded → no base commit to pin → last-write-wins.

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current.mutateAsync({
        id: "REEF-001",
        vault: "reef-acme",
        patch: { status: "in_progress" },
      });
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.update).not.toHaveProperty("expected_commit");
  });

  it("refetches the detail query on a 409 save conflict (REEF-227)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Save conflict occurred — please refresh and try again.",
        }),
        { status: 409 },
      ),
    );
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
      issue: ORIGINAL,
      content: "old",
      commit_hash: "c1",
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderUseUpdateIssue(queryClient);

    await act(async () => {
      await result.current
        .mutateAsync({
          id: "REEF-001",
          vault: "reef-acme",
          patch: {},
          content: "edited",
        })
        .catch(() => {});
    });

    // The stale base is re-read so the editor refreshes and a retry writes
    // against the latest. (This fires on 409 — not the success path.)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "detail", "reef-acme", "REEF-001"],
    });
  });

  it("propagates 409 conflict (akb LWW race) as error", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Another change reached the workspace first.",
        }),
        { status: 409 },
      ),
    );
    const { result } = renderUseUpdateIssue();

    await act(async () => {
      await result.current
        .mutateAsync({
          id: "REEF-001",
          vault: "reef-acme",
          patch: { status: "in_progress" },
        })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error as Error & { status?: number };
    expect(err.status).toBe(409);
  });
});
