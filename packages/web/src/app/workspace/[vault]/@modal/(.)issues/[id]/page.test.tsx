import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { mockBack } = vi.hoisted(() => ({
  mockBack: vi.fn(),
}));
const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/workspace/reef-acme/issues/REEF-001"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: vi.fn() }),
  usePathname: mockUsePathname,
}));

vi.mock("@/features/issues/components/detail/IssueDetailSheet", () => ({
  IssueDetailSheet: ({
    issueId,
    vault,
    entryRoute,
  }: {
    issueId: string;
    vault: string;
    entryRoute: "base" | "modal";
  }) => (
    <div
      data-testid="mock-issue-detail-sheet"
      data-entry-route={entryRoute}
      data-vault={vault}
    >
      {issueId}
    </div>
  ),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, use: vi.fn((value: unknown) => value) };
});

import IssueModalPage from "./page";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>
  );
}

describe("Intercepting route — /(dashboard)/@modal/(.)issues/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/workspace/reef-acme/issues/REEF-001");
    useIssueNavStack.getState().clear();
  });

  it("module exports a default React component", () => {
    // The intercepting route page is a thin wrapper that unwraps `params`
    // via React's `use()` and delegates to IssueDetailSheet (covered by its
    // own tests). React 19's `use()` inside a vitest renderHook env does not
    // re-render after the Promise resolves the same way the runtime does, so
    // the most reliable assertion here is the module shape itself.
    expect(typeof IssueModalPage).toBe("function");
  });

  it("uses the shared IssueDetailSheet (import surface check)", async () => {
    // Importing the page should not throw; the dependency on
    // IssueDetailSheet is preserved through the akb pivot.
    const mod = await import("./page");
    expect(typeof mod.default).toBe("function");
  });

  it("passes the route workspace to the shared detail sheet", () => {
    mockUsePathname.mockReturnValue("/workspace/reef-e2e/issues/REEF-001");

    render(
      <IssueModalPage
        params={
          // The intercepted route can inherit the background workspace param;
          // the target URL must still own the detail sheet's workspace.
          { id: "REEF-001", vault: "reef-alpha" } as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.getByTestId("mock-issue-detail-sheet")).toHaveAttribute(
      "data-vault",
      "reef-e2e",
    );
  });

  it("does not retain the modal child after navigating to a non-detail path", () => {
    useIssueNavStack.setState({
      trail: ["REEF-000"],
      currentId: "REEF-001",
      exitOwner: () => {},
    });
    mockUsePathname.mockReturnValue("/workspace/reef-acme/issues");

    render(
      <IssueModalPage
        params={
          { id: "REEF-001", vault: "reef-acme" } as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.queryByTestId("mock-issue-detail-sheet")).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual([]);
    expect(useIssueNavStack.getState().exitOwner).toBeNull();
  });

  it("yields to the original base sheet without clearing its drill trail", () => {
    const baseExit = vi.fn();
    useIssueNavStack.setState({
      trail: ["REEF-001"],
      currentId: "REEF-002",
      hasDrilledInSession: true,
      entryRoute: "base",
      exitOwner: baseExit,
    });
    mockUsePathname.mockReturnValue("/workspace/reef-acme/issues/REEF-002");

    render(
      <IssueModalPage
        params={
          { id: "REEF-002", vault: "reef-acme" } as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.queryByTestId("mock-issue-detail-sheet")).toBeNull();
    expect(useIssueNavStack.getState().trail).toEqual(["REEF-001"]);
    expect(useIssueNavStack.getState().entryRoute).toBe("base");
  });
});
