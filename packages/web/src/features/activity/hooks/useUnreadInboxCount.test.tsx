import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadInboxCount } from "./useUnreadInboxCount";

const getConfigValueMock = vi.fn();
vi.mock("@/lib/storage/config", () => ({
  getConfigValue: (...args: unknown[]) => getConfigValueMock(...args),
}));

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

function makeDraft(createdAt: string) {
  return {
    id: `reef-draft-${createdAt.replace(/\D/g, "").slice(0, 16)}`,
    kind: "draft" as const,
    proposal: {
      operation: "create" as const,
      create: { fields: { title: "x" }, content: "y" },
    },
    repo: "octo/cat",
    fingerprint: `octo/cat:commit:${createdAt}`,
    provenance: {
      type: "commit" as const,
      ref: createdAt,
      repo: "octo/cat",
      actor: "alice",
      detectedAt: createdAt,
    },
    confidence: 0.8,
    reasoning: "test",
    status: "pending" as const,
    created_at: createdAt,
    detected_at: createdAt,
  };
}

function makeStatusChange(createdAt: string) {
  return {
    id: `reef-status-${createdAt.replace(/\D/g, "").slice(0, 16)}`,
    kind: "status_change" as const,
    repo: "octo/cat",
    fingerprint: `REEF-001:${createdAt}`,
    proposal: {
      operation: "update" as const,
      update: {
        issue_id: "REEF-001",
        patch: { status: "done" as const },
      },
    },
    issue_title: "Existing",
    from_status: "in_review" as const,
    rationale: "PR merged, so the issue is done.",
    evidence: [
      {
        type: "commit" as const,
        ref: `sha-${createdAt}`,
        repo: "octo/cat",
        actor: "alice",
      },
    ],
    confidence: 0.9,
    status: "pending" as const,
    created_at: createdAt,
    detected_at: createdAt,
  };
}

// The hook reads two endpoints (suggestions + events); route by URL so the
// assertions do not depend on the order the two queries fire.
function mockApi({
  suggestions = [],
  events = [],
}: {
  suggestions?: unknown[];
  events?: unknown[];
} = {}) {
  mockedApiFetch.mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).includes("/api/activity/events")
      ? { events }
      : { suggestions };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}

function makeEvent(at: string) {
  return {
    id: `evt-${at.replace(/\D/g, "").slice(0, 16)}`,
    reef_id: "REEF-001",
    event_type: "status_change",
    event_key: `status_change:todo->in_progress@${at}`,
    payload: { from: "todo", to: "in_progress" },
    actor: "alice",
    at,
    source: null,
    issue_title: "Existing",
  };
}

describe("useUnreadInboxCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when there is no last_visit_at recorded", async () => {
    getConfigValueMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useUnreadInboxCount("reef-acme"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(0));
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("counts draft and status-change suggestions created after the last visit", async () => {
    getConfigValueMock.mockResolvedValue("2026-05-01T00:00:00.000Z");
    mockApi({
      suggestions: [
        makeDraft("2026-04-30T00:00:00.000Z"),
        makeDraft("2026-05-02T00:00:00.000Z"),
        makeDraft("2026-05-03T00:00:00.000Z"),
        makeStatusChange("2026-04-30T00:00:00.000Z"),
        makeStatusChange("2026-05-04T00:00:00.000Z"),
      ],
    });

    const { result } = renderHook(() => useUnreadInboxCount("reef-acme"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("adds recorded issue-change events since the last visit to the count", async () => {
    getConfigValueMock.mockResolvedValue("2026-05-01T00:00:00.000Z");
    mockApi({
      suggestions: [makeDraft("2026-05-02T00:00:00.000Z")],
      // The server already filters events by `since`, so all returned events
      // count.
      events: [
        makeEvent("2026-05-02T00:00:00.000Z"),
        makeEvent("2026-05-03T00:00:00.000Z"),
      ],
    });

    const { result } = renderHook(() => useUnreadInboxCount("reef-acme"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("returns 0 when no suggestions or events are pending", async () => {
    getConfigValueMock.mockResolvedValue("2026-05-01T00:00:00.000Z");
    mockApi();

    const { result } = renderHook(() => useUnreadInboxCount("reef-acme"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(0));
  });
});
