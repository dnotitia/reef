import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockBack = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

vi.mock("@/features/issues/components/filters/IssuesWorkspace", () => ({
  IssuesWorkspace: () => <div data-testid="issues-workspace-backdrop" />,
}));

vi.mock("@/features/issues/components/detail/IssueDetailSheet", () => ({
  IssueDetailSheet: ({
    issueId,
    onClose,
  }: { issueId: string; onClose: () => void }) => (
    <div data-testid="issue-detail-sheet" data-issue-id={issueId}>
      <button type="button" data-testid="mock-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    use: vi.fn((val: unknown) => val),
  };
});

import IssuePage from "./page";

function makeParams(id: string) {
  return { id, vault: "reef-acme" };
}

describe("IssuePage (base route — hard navigation deep link)", () => {
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
  });

  // regression for the hydration mismatch (REEF-165). The sheet is a modal Radix
  // Dialog whose aria-hidden management mutates the backdrop DOM; rendering it in
  // the same SSR/hydration pass as the IssuesWorkspace backdrop made those
  // mutations clash with hydration across the whole backdrop subtree. The sheet
  // should be deferred to a post-mount client render, so server output carries the
  // backdrop but NOT the sheet (effects do not run during SSR, so `mounted` stays
  // false and the sheet is gated out).
  it("omits the IssueDetailSheet from server-rendered output (deferred to post-mount)", () => {
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
    mockBack.mockClear();
    mockPush.mockClear();
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
});
