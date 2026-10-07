import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBack, mockPush, mockUseSearchParams } = vi.hoisted(() => ({
  mockBack: vi.fn(),
  mockPush: vi.fn(),
  mockUseSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useSearchParams: mockUseSearchParams,
}));

vi.mock("@/features/issues/components/filters/IssuesWorkspace", () => ({
  IssuesWorkspace: () => <div data-testid="issues-workspace-backdrop" />,
}));

vi.mock("@/features/issues/components/detail/IssueDetailSheet", () => ({
  IssueDetailSheet: ({
    issueId,
    vault,
    entryRoute,
    onReady,
    onClose,
    disableOpenAnimation,
  }: {
    issueId: string;
    vault: string;
    entryRoute: "base" | "modal";
    onReady?: () => void;
    onClose: () => void;
    disableOpenAnimation?: boolean;
  }) => {
    useEffect(() => onReady?.(), [onReady]);
    return (
      <div
        data-testid="issue-detail-sheet"
        data-issue-id={issueId}
        data-vault={vault}
        data-entry-route={entryRoute}
        data-disable-open-animation={disableOpenAnimation ? "true" : "false"}
      >
        <button type="button" data-testid="mock-close" onClick={onClose}>
          Close
        </button>
      </div>
    );
  },
}));

vi.mock(
  "@/features/issues/components/detail/IssueDetailAuthPendingSkeleton",
  () => ({
    IssueDetailAuthPendingSkeleton: ({
      issueId,
      searchParams,
      showWorkspaceSkeleton,
    }: {
      issueId: string;
      searchParams: string;
      showWorkspaceSkeleton: boolean;
    }) => (
      <div
        data-testid="issue-detail-pending-shell"
        data-issue-id={issueId}
        data-search-params={searchParams}
      >
        {showWorkspaceSkeleton ? (
          <div data-testid="issues-workspace-backdrop" />
        ) : null}
      </div>
    ),
  }),
);

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    use: vi.fn((val: unknown) => val),
  };
});

import IssuePage from "./page";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";

function makeParams(id: string) {
  return { id, vault: "reef-acme" };
}

describe("IssuePage (base route — hard navigation deep link)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    useIssueNavStack.getState().clear();
  });

  it("renders the IssuesWorkspace backdrop and, after mount, the IssueDetailSheet", () => {
    render(
      <IssuePage
        params={
          makeParams("REEF-001") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );
    expect(screen.getByTestId("issues-workspace-backdrop")).toBeInTheDocument();
    // RTL flushes effects, so the post-mount sheet is present here.
    expect(screen.getByTestId("issue-detail-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("issue-detail-sheet")).toHaveAttribute(
      "data-entry-route",
      "base",
    );
    expect(screen.getByTestId("issue-detail-sheet")).toHaveAttribute(
      "data-vault",
      "reef-acme",
    );
    expect(screen.getByTestId("issue-detail-sheet")).toHaveAttribute(
      "data-disable-open-animation",
      "true",
    );
  });

  // regression for the hydration mismatch (REEF-165). The sheet is a modal Radix
  // Dialog whose aria-hidden management mutates the backdrop DOM; rendering it in
  // the same SSR/hydration pass as the IssuesWorkspace backdrop made those
  // mutations clash with hydration across the whole backdrop subtree. The sheet
  // should be deferred to a post-mount client render. A static detail shell is
  // safe in server output and keeps the route visible until that mount.
  it("renders the safe detail shell but omits the interactive Sheet on the server", () => {
    const html = renderToString(
      <IssuePage
        params={
          makeParams("REEF-001") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );
    expect(html).toContain("issue-detail-pending-shell");
    expect(html).toContain("issues-workspace-backdrop");
    expect(html).not.toContain("issue-detail-sheet");
  });

  it("forwards the id from params to the sheet", () => {
    render(
      <IssuePage
        params={
          makeParams("REEF-042") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );
    expect(screen.getByTestId("issue-detail-sheet")).toHaveAttribute(
      "data-issue-id",
      "REEF-042",
    );
  });

  it("closes by pushing the vault-scoped issues list — never relies on history.back()", () => {
    render(
      <IssuePage
        params={
          makeParams("REEF-001") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );
    screen.getByTestId("mock-close").click();
    expect(mockPush).toHaveBeenCalledWith("/workspace/reef-acme/issues");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("preserves the entry view, filter, and sort query on close", () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("view=list&status=todo&sort=priority&order=desc"),
    );
    render(
      <IssuePage
        params={
          makeParams("REEF-001") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    screen.getByTestId("mock-close").click();

    expect(mockPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues?view=list&status=todo&sort=priority&order=desc",
    );
  });

  it("keeps the base sheet mounted and updates it to the drilled issue", () => {
    useIssueNavStack.getState().registerExitOwner(() => {}, "base");
    useIssueNavStack.getState().drill("REEF-103", "REEF-102");

    render(
      <IssuePage
        params={
          makeParams("REEF-103") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.getByTestId("issue-detail-sheet")).toHaveAttribute(
      "data-issue-id",
      "REEF-102",
    );
  });

  it("does not render a second sheet in the base slot when the modal owns the session", () => {
    useIssueNavStack.getState().registerExitOwner(() => {}, "modal");

    render(
      <IssuePage
        params={
          makeParams("REEF-042") as unknown as Promise<{
            id: string;
            vault: string;
          }>
        }
      />,
    );

    expect(screen.queryByTestId("issue-detail-sheet")).toBeNull();
  });
});
