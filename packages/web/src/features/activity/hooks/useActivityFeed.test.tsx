import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityFeed } from "./useActivityFeed";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

const mockedApiFetch = vi.mocked(apiFetch);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const makeDraft = (id: string, createdAt: string) => ({
  id,
  kind: "draft" as const,
  proposal: {
    operation: "create" as const,
    create: {
      fields: { title: `Draft ${id}` },
      content: "Test description",
    },
  },
  repo: "owner/repo",
  fingerprint: `owner/repo:commit:${id}`,
  provenance: {
    type: "commit" as const,
    ref: "abc123",
    repo: "owner/repo",
    actor: "actor",
    detectedAt: createdAt,
  },
  confidence: 0.9,
  reasoning: "Test reasoning",
  status: "pending" as const,
  created_at: createdAt,
  detected_at: createdAt,
});

const makeStatusChange = (id: string, createdAt: string) => ({
  id,
  kind: "status_change" as const,
  repo: "owner/repo",
  fingerprint: `REEF-101:${id}`,
  proposal: {
    operation: "update" as const,
    update: {
      issue_id: "REEF-101",
      patch: { status: "in_review" as const },
    },
  },
  issue_title: "Issue REEF-101",
  from_status: "in_progress" as const,
  rationale: `Status change ${id}`,
  evidence: [
    { type: "pr" as const, ref: "294", repo: "owner/repo", actor: "dev" },
  ],
  confidence: 0.85,
  status: "pending" as const,
  created_at: createdAt,
  detected_at: createdAt,
});

function mockSuggestions(suggestions: unknown[]) {
  mockedApiFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ suggestions }), { status: 200 }),
  );
}

// Route by URL so the suggestions + events queries can resolve in any order.
function mockFeed({
  suggestions = [],
  events = [],
}: {
  suggestions?: unknown[];
  events?: unknown[];
}) {
  mockedApiFetch.mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).includes("/api/activity/events")
      ? { events }
      : { suggestions };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}

const makeEvent = (id: string, at: string) => ({
  id,
  reef_id: "REEF-208",
  event_type: "status_change",
  event_key: `status_change:todo->in_progress@${at}`,
  payload: { from: "todo", to: "in_progress" },
  actor: "alice",
  at,
  source: null,
  issue_title: "Backlog rank drag ordering",
});

describe("useActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty items when there are no pending suggestions", async () => {
    mockSuggestions([]);

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/activity/suggestions?vault=reef-acme&status=pending",
    );
  });

  it("includes ai_draft items from pending draft suggestions", async () => {
    const draft = makeDraft(
      "reef-draft-0000000000000001",
      "2026-04-13T10:00:00.000Z",
    );
    mockSuggestions([draft]);

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const draftItems = result.current.items.filter(
      (i) => i.type === "ai_draft",
    );
    expect(draftItems).toHaveLength(1);
    expect(draftItems[0].id).toBe("reef-draft-0000000000000001");
    expect(draftItems[0].draft).toEqual(draft);
  });

  it("includes ai_status_change items from pending status change suggestions", async () => {
    const statusChange = makeStatusChange(
      "reef-status-0000000000000001",
      "2026-04-13T11:00:00.000Z",
    );
    mockSuggestions([statusChange]);

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const statusChangeItems = result.current.items.filter(
      (i) => i.type === "ai_status_change",
    );
    expect(statusChangeItems).toHaveLength(1);
    expect(statusChangeItems[0].id).toBe("reef-status-0000000000000001");
    expect(statusChangeItems[0].statusChange).toEqual(statusChange);
    expect(statusChangeItems[0].statusChange.from_status).toBe("in_progress");
    expect(statusChangeItems[0].statusChange.proposal.update.patch.status).toBe(
      "in_review",
    );
    expect(statusChangeItems[0].statusChange.rationale).toBe(
      "Status change reef-status-0000000000000001",
    );
  });

  it("sorts all items by timestamp descending", async () => {
    const draft = makeDraft(
      "reef-draft-0000000000000001",
      "2026-04-13T12:00:00.000Z",
    );
    const statusChange = makeStatusChange(
      "reef-status-0000000000000001",
      "2026-04-13T11:00:00.000Z",
    );
    mockSuggestions([statusChange, draft]);

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const { items } = result.current;
    expect(items.length).toBeGreaterThan(0);

    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].timestamp >= items[i + 1].timestamp).toBe(true);
    }
    expect(items[0].type).toBe("ai_draft");
  });

  it("refreshInbox refetches suggestions and updates feed", async () => {
    const initialDraft = makeDraft(
      "reef-draft-0000000000000001",
      "2026-04-13T10:00:00.000Z",
    );
    const refreshedDraft = makeDraft(
      "reef-draft-0000000000000002",
      "2026-04-13T11:00:00.000Z",
    );
    mockedApiFetch
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ suggestions: [initialDraft] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ suggestions: [refreshedDraft] }), {
          status: 200,
        }),
      );

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items.map((i) => i.id)).toEqual([
      "reef-draft-0000000000000001",
    ]);

    await result.current.refreshInbox();

    await waitFor(() => {
      expect(result.current.items.map((i) => i.id)).toEqual([
        "reef-draft-0000000000000002",
      ]);
    });
  });

  it("drafts and status changes appear together", async () => {
    const draft = makeDraft(
      "reef-draft-0000000000000001",
      "2026-04-13T12:00:00.000Z",
    );
    const statusChange = makeStatusChange(
      "reef-status-0000000000000001",
      "2026-04-13T11:00:00.000Z",
    );
    mockSuggestions([draft, statusChange]);

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const types = result.current.items.map((i) => i.type);
    expect(types).toContain("ai_draft");
    expect(types).toContain("ai_status_change");
  });

  it("does not fetch issue-change events without an eventsSince marker", async () => {
    mockFeed({ suggestions: [] });

    const { result } = renderHook(() => useActivityFeed("reef-acme"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Only the suggestions endpoint is hit; the change stream stays dormant
    // until the page captures last_visit_at.
    for (const [url] of mockedApiFetch.mock.calls) {
      expect(url).not.toContain("/api/activity/events");
    }
  });

  it("merges issue_change events with suggestions when eventsSince is set", async () => {
    mockFeed({
      suggestions: [
        makeDraft("reef-draft-0000000000000001", "2026-04-13T12:00:00.000Z"),
      ],
      events: [makeEvent("evt-1", "2026-04-13T11:30:00.000Z")],
    });

    const { result } = renderHook(
      () => useActivityFeed("reef-acme", "2026-04-13T09:00:00.000Z"),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      const types = result.current.items.map((i) => i.type);
      expect(types).toContain("ai_draft");
      expect(types).toContain("issue_change");
    });

    const issueChange = result.current.items.find(
      (i) => i.type === "issue_change",
    );
    expect(issueChange).toMatchObject({
      id: "event:evt-1",
      issueId: "REEF-208",
      issueTitle: "Backlog rank drag ordering",
    });
    // The requested events query carries the since marker.
    const eventCall = mockedApiFetch.mock.calls.find(([url]) =>
      String(url).includes("/api/activity/events"),
    );
    expect(String(eventCall?.[0])).toContain(
      "since=2026-04-13T09%3A00%3A00.000Z",
    );

    // Newest first: the 12:00 draft precedes the 11:30 change.
    expect(result.current.items[0]?.type).toBe("ai_draft");
  });

  it("refreshInbox refetches the issue-change stream too", async () => {
    mockFeed({
      suggestions: [],
      events: [makeEvent("evt-1", "2026-04-13T11:30:00.000Z")],
    });

    const { result } = renderHook(
      () => useActivityFeed("reef-acme", "2026-04-13T09:00:00.000Z"),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const eventCallsBefore = mockedApiFetch.mock.calls.filter(([url]) =>
      String(url).includes("/api/activity/events"),
    ).length;

    await result.current.refreshInbox();

    await waitFor(() => {
      const eventCallsAfter = mockedApiFetch.mock.calls.filter(([url]) =>
        String(url).includes("/api/activity/events"),
      ).length;
      expect(eventCallsAfter).toBeGreaterThan(eventCallsBefore);
    });
  });
});
