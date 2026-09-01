import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dndHarness, fetchNextPage } = vi.hoisted(() => ({
  dndHarness: {
    props: undefined as
      | {
          onDragEnd?: (event: {
            active: { id: string };
            over: { id: string } | null;
          }) => void;
          onDragCancel?: (event: { active: { id: string } }) => void;
          children?: ReactNode;
        }
      | undefined,
  },
  fetchNextPage: vi.fn(),
}));

type DndHarnessProps = NonNullable<typeof dndHarness.props>;

vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: DndHarnessProps) => {
    dndHarness.props = props;
    return <div data-testid="list-dnd-context">{props.children}</div>;
  },
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  useSensor: vi.fn((sensor: unknown, options: unknown) => ({
    sensor,
    options,
  })),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  })),
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
    isOver: false,
  })),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@/features/issues/hooks/queries/useInfiniteIssueList", () => ({
  useInfiniteIssueList: () => ({
    data: {
      pages: [
        {
          issues: [
            {
              id: "REEF-001",
              title: "First",
              status: "todo",
              rank: 1000,
              created_at: "2026-05-01T00:00:00.000Z",
              created_by: "alice",
              updated_at: "2026-05-01T00:00:00.000Z",
              updated_by: "alice",
            },
            {
              id: "REEF-002",
              title: "Second",
              status: "todo",
              rank: 2000,
              created_at: "2026-05-01T00:00:00.000Z",
              created_by: "alice",
              updated_at: "2026-05-01T00:00:00.000Z",
              updated_by: "alice",
            },
          ],
          next_cursor: "next-page",
        },
      ],
      pageParams: [null],
    },
    isPending: false,
    isFetching: false,
    isError: false,
    isPlaceholderData: false,
    fetchNextPage,
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/issues/hooks/queries/useIssueRelations", () => ({
  useIssueRelations: () => ({ data: [] }),
}));
vi.mock("@/features/issues/hooks/useResolvedAutoHideWindows", () => ({
  useResolvedAutoHideWindows: () => undefined,
}));
vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: undefined }),
}));
vi.mock("@/features/issues/hooks/queries/useUserSearch", () => ({
  useUserSearch: () => ({ data: [] }),
}));
vi.mock("@/features/settings/hooks/useVaultRoster", () => ({
  useVaultRoster: () => ({ data: [] }),
}));
vi.mock("@/features/issues/hooks/view/useOpenIssue", () => ({
  useOpenIssue: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { IssueListTable } from "./IssueListTable";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("IssueListTable Manual reorder boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchNextPage.mockClear();
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
    useFlashStore.setState({
      flashedIssueKeys: new Set(),
      reorderFlashedIssueKeys: new Set(),
    });
  });

  it("loads another canonical page instead of sending an unsafe null after anchor", async () => {
    render(wrap(<IssueListTable vault="reef-acme" />));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    fetchNextPage.mockClear();
    dndHarness.props?.onDragEnd?.({
      active: { id: "REEF-001" },
      over: { id: "REEF-002" },
    });

    await waitFor(() => expect(fetchNextPage).toHaveBeenCalled());
    expect(
      vi
        .mocked(apiFetch)
        .mock.calls.some(([url]) => url === "/api/issues/reorder"),
    ).toBe(false);
  });

  it("restores focus to the reorder handle after a keyboard drop or cancel", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, assignments: [] }), {
        status: 200,
      }),
    );
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByTestId("issue-list-grip-REEF-002");

    act(() => {
      dndHarness.props?.onDragEnd?.({
        active: { id: "REEF-002" },
        over: { id: "REEF-001" },
      });
    });
    expect(useIssueKeyboardStore.getState().focusRequest).toMatchObject({
      scope: "list",
      issueId: "REEF-002",
      target: "reorder-handle",
    });
    await waitFor(() =>
      expect(screen.getByTestId("issue-list-grip-REEF-002")).toHaveFocus(),
    );

    act(() => {
      dndHarness.props?.onDragCancel?.({ active: { id: "REEF-001" } });
    });
    expect(useIssueKeyboardStore.getState().focusRequest).toMatchObject({
      scope: "list",
      issueId: "REEF-001",
      target: "reorder-handle",
    });
    await waitFor(() =>
      expect(screen.getByTestId("issue-list-grip-REEF-001")).toHaveFocus(),
    );
  });

  it("shows identity-bound persistence feedback through canonical settlement", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (url === "/api/issues/reorder") return pendingResponse;
      return new Response("{}", { status: 200 });
    });
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("Second");

    act(() => {
      dndHarness.props?.onDragEnd?.({
        active: { id: "REEF-002" },
        over: { id: "REEF-001" },
      });
    });

    const movedRow = () =>
      screen
        .getAllByTestId("issue-list-row")
        .find((row) => row.getAttribute("data-issue-id") === "REEF-002");
    await waitFor(() =>
      expect(movedRow()).toHaveAttribute("data-reorder-state", "pending"),
    );
    const moved = movedRow();
    expect(moved).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByTestId("reorder-persistence-announcement"),
    ).toHaveTextContent("Saving REEF-002's position…");
    expect(useFlashStore.getState().flashedIssueKeys).toEqual(new Set());

    await act(async () => {
      resolveResponse(
        new Response(
          JSON.stringify({
            ok: true,
            assignments: [{ id: "REEF-002", rank: 1500 }],
          }),
          { status: 200 },
        ),
      );
    });

    await waitFor(() =>
      expect(useFlashStore.getState().reorderFlashedIssueKeys).toContain(
        "reef-acme:REEF-002",
      ),
    );
    expect(
      screen.getByTestId("reorder-persistence-announcement"),
    ).toHaveTextContent("REEF-002's position saved.");
    expect(movedRow()).toHaveAttribute("data-reorder-state", "success");
    expect(movedRow()).toHaveClass("reef-flash-row");
  });
});
