import { useIssueSheetDismiss } from "@/features/issues/hooks/view/useIssueSheetDismiss";
import { useIssueDrill } from "@/features/issues/hooks/view/useIssueDrill";
import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModalDefault from "./default";

const { mockReplace, mockUsePathname } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockUsePathname: vi.fn(() => "/workspace/reef-e2e/issues/REEF-101"),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams("view=list"),
}));

const ROOT = "REEF-101";
const CHILD = "REEF-104";

function BaseDetailSession({ onExit }: { onExit: () => void }) {
  const hasDrilledInSession = useIssueNavStack(
    (state) => state.hasDrilledInSession,
  );
  const currentId = useIssueNavStack((state) => state.currentId);
  const issueId = hasDrilledInSession && currentId ? currentId : ROOT;
  const { backTo, goBack } = useIssueSheetDismiss({
    entryRoute: "base",
    issueId,
    vault: "reef-e2e",
    onExit,
  });
  const firstRelationship = useIssueDrill(issueId, "reef-e2e")(CHILD);

  return (
    <>
      <output data-testid="base-issue-id">{issueId}</output>
      <a data-testid="first-relationship" {...firstRelationship}>
        Open related issue
      </a>
      {backTo ? (
        <button
          type="button"
          data-testid="issue-drill-back"
          data-back-to={backTo}
          onClick={goBack}
        >
          Back
        </button>
      ) : null}
    </>
  );
}

afterEach(() => {
  useIssueNavStack.getState().clear();
  mockReplace.mockClear();
  window.history.replaceState(null, "", "/");
});

beforeEach(() => {
  mockUsePathname.mockReturnValue("/workspace/reef-e2e/issues/REEF-101");
});

describe("ModalDefault (REEF-270 drill session boundary)", () => {
  it("preserves a cold base detail owner and first relationship Back trail", () => {
    const onExit = vi.fn();

    render(
      <>
        <BaseDetailSession onExit={onExit} />
        <ModalDefault />
      </>,
    );

    expect(useIssueNavStack.getState()).toMatchObject({
      currentId: ROOT,
      entryRoute: "base",
      exitOwner: onExit,
    });

    act(() => fireEvent.click(screen.getByTestId("first-relationship")));

    expect(window.location.pathname).toBe(
      `/workspace/reef-e2e/issues/${CHILD}`,
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useIssueNavStack.getState()).toMatchObject({
      trail: [ROOT],
      currentId: CHILD,
      entryRoute: "base",
      exitOwner: onExit,
    });
    expect(screen.getByTestId("issue-drill-back")).toHaveAttribute(
      "data-back-to",
      ROOT,
    );
  });

  it("clears the drill session when the pathname returns to the list", () => {
    const exitOwner = vi.fn();
    mockUsePathname.mockReturnValue("/workspace/reef-e2e/issues");
    useIssueNavStack.setState({
      trail: ["REEF-100"],
      currentId: ROOT,
      entryRoute: "base",
      exitOwner,
    });

    render(<ModalDefault />);

    expect(useIssueNavStack.getState()).toMatchObject({
      trail: [],
      currentId: null,
      entryRoute: null,
      exitOwner: null,
    });
  });

  it("renders nothing", () => {
    const { container } = render(<ModalDefault />);
    expect(container.firstChild).toBeNull();
  });
});
