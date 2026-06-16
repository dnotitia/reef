import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { vi } from "vitest";

export interface CapturedDragEvent {
  active: { data: { current?: unknown } };
  over?: { id: string } | null;
}

export interface CapturedDndContextProps {
  children: ReactNode;
  collisionDetection?: unknown;
  onDragCancel?: () => void;
  onDragEnd?: (event: CapturedDragEvent) => void;
  onDragStart?: (event: CapturedDragEvent) => void;
  sensors?: unknown;
}

const dndHarness = vi.hoisted(() => ({
  contextProps: undefined as CapturedDndContextProps | undefined,
  pointerWithin: vi.fn(),
}));

export { dndHarness };

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: CapturedDndContextProps) => {
    dndHarness.contextProps = props;
    return <div data-testid="dnd-context">{props.children}</div>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  PointerSensor: vi.fn(),
  pointerWithin: dndHarness.pointerWithin,
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
  // KanbanBoard builds a module-level DropAnimation from this factory.
  defaultDropAnimationSideEffects: vi.fn(() => undefined),
  useSensor: vi.fn((sensor: unknown, options: unknown) => ({
    options,
    sensor,
  })),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

// Stub auto-animate (used by KanbanColumn) so its controller doesn't trigger
// an extra render that would consume one-shot dnd-kit mocks.
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [vi.fn()],
}));

import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";

export const mockApiFetch = vi.mocked(apiFetch);

export const ISSUES: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Open A",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-002",
    title: "In progress B",
    status: "in_progress",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

export const FILTER_ISSUES: IssueMetadata[] = [
  {
    id: "REEF-010",
    title: "UI board polish",
    status: "todo",
    priority: "high",
    assigned_to: "alice",
    labels: ["ui"],
    depends_on: ["REEF-013"],
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-011",
    title: "API cleanup",
    status: "in_progress",
    priority: "low",
    assigned_to: "bob",
    labels: ["api"],
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-012",
    title: "Security review",
    status: "in_review",
    priority: "critical",
    assigned_to: "carol",
    labels: ["security"],
    archived_at: "2026-05-02T00:00:00.000Z",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "REEF-013",
    title: "Backend blocker",
    status: "todo",
    priority: "medium",
    assigned_to: "dana",
    labels: ["backend"],
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

export function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

export function resetKanbanBoardMocks() {
  vi.clearAllMocks();
  dndHarness.contextProps = undefined;
  useIssueStore.setState({
    filter: {},
    searchQuery: "",
    selectedIssueId: null,
  });
}

export { KanbanBoard } from "./KanbanBoard";
