import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import type { IssueListItem } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Drive `isPlaceholderData` directly by mocking the list query — the reorder
// freshness guard (REEF-129) depends on it and does not be reproduced through the
// real hook in jsdom without a live refetch race.
const { mockUseIssueList, mockUseReorderBacklog } = vi.hoisted(() => ({
  mockUseIssueList: vi.fn(),
  mockUseReorderBacklog: vi.fn(),
}));

vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: mockUseIssueList,
}));
vi.mock("@/features/issues/hooks/queries/useIssueRelations", () => ({
  useIssueRelations: () => ({ data: undefined }),
}));
vi.mock("@/features/issues/hooks/mutations/useReorderBacklog", () => ({
  useReorderBacklog: mockUseReorderBacklog,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BacklogView } from "./BacklogView";

const ISSUE: IssueListItem = {
  id: "REEF-1",
  title: "Deferred idea",
  status: "backlog",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

function listResult(isPlaceholderData: boolean) {
  return {
    data: [ISSUE],
    isPending: false,
    isError: false,
    isPlaceholderData,
    refetch: vi.fn(),
  };
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("BacklogView reorder freshness guard (REEF-129)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReorderBacklog.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("shows the drag grip on fresh, settled data", () => {
    mockUseIssueList.mockReturnValue(listResult(false));
    render(wrap(<BacklogView vault="reef-acme" />));
    expect(screen.getByTestId("backlog-grip-REEF-1")).toBeInTheDocument();
  });

  it("hides the drag grip while the list is still placeholder data", () => {
    mockUseIssueList.mockReturnValue(listResult(true));
    render(wrap(<BacklogView vault="reef-acme" />));
    expect(screen.queryByTestId("backlog-grip-REEF-1")).toBeNull();
  });

  it("hides the drag grip while a previous reorder is still in flight", () => {
    // Overlapping reorders POST absolute ranks that can land out of order under
    // last-write-wins; blocking a new drag until the prior one settles keeps the
    // user's final action authoritative.
    mockUseIssueList.mockReturnValue(listResult(false));
    mockUseReorderBacklog.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    });
    render(wrap(<BacklogView vault="reef-acme" />));
    expect(screen.queryByTestId("backlog-grip-REEF-1")).toBeNull();
  });
});
