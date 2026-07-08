import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { mockUseActiveVault, mockReplace } = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));

// The sheet's drill-aware dismiss controller reads router + the live query
// (REEF-270). With an empty trail there is no Back affordance.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// `data-next-link` marks anchors routed through Next `Link`; a raw `<a>` lacks
// it, so the no-vault CTA assertion fails if the Settings link regresses to a
// full-reload anchor (REEF-262).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The persistent chrome bar reads these for its identity cluster (REEF-286).
// They are query data, not what these chrome/dismiss tests exercise, so stub
// them empty — the bar then shows the route-param id alone, which is exactly the
// loading / id fallback state the AC2 assertions check.
vi.mock("@/features/issues/hooks/queries/useIssue", () => ({
  useIssue: () => ({ data: undefined }),
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => ({ data: undefined, isPending: false }),
}));

import { useIssueNavStack } from "@/features/issues/stores/useIssueNavStack";
import { IssueDetailSheet } from "./IssueDetailSheet";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("IssueDetailSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIssueNavStack.setState({ trail: [], currentId: null });
  });

  it("renders the skeleton path while vault is loading", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: true,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    // Skeletons render a series of <Skeleton/> elements — no error thrown is the smoke check.
    expect(screen.getByTestId("issue-detail-modal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("issue-detail-no-vault"),
    ).not.toBeInTheDocument();
  });

  it('renders the "Configure a workspace" CTA with a client-side Settings link when no vault is set (REEF-262)', () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    expect(screen.getByTestId("issue-detail-no-vault")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("data-next-link", "true");
  });

  it("mounts IssueDetail when vault is available", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));
    expect(
      screen.queryByTestId("issue-detail-no-vault"),
    ).not.toBeInTheDocument();
  });

  // REEF-111: opting out of the shared SheetContent X should not leave a sheet
  // state without a visible close control. Every state exposes exactly one
  // close button — the in-flow replacement (data-testid="issue-close"), does not
  // the shared overlay X (which carries no test id).
  it.each([
    ["vault loading", { vault: "", isLoading: true }],
    ["no vault", { vault: "", isLoading: false }],
    ["vault available", { vault: "reef-acme", isLoading: false }],
  ])("always exposes a single close button (%s)", (_label, vaultState) => {
    mockUseActiveVault.mockReturnValue({
      ...vaultState,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const closers = screen.getAllByRole("button", { name: "Close" });
    expect(closers).toHaveLength(1);
    expect(closers[0]).toHaveAttribute("data-testid", "issue-close");
  });

  // REEF-286: the identity/nav bar is persistent chrome outside the body, so the
  // route-param id fills the bar's left in every state — there is no empty
  // band, and the id does not blink while the body below skeletons (AC1 · AC2).
  it.each([
    ["vault loading", { vault: "", isLoading: true }],
    ["no vault", { vault: "", isLoading: false }],
    ["vault available", { vault: "reef-acme", isLoading: false }],
  ])("fills the chrome bar with the issue id (%s)", (_label, vaultState) => {
    mockUseActiveVault.mockReturnValue({
      ...vaultState,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const bar = screen.getByTestId("issue-detail-chrome");
    expect(bar).toHaveTextContent("REEF-001");
    // The bar also owns the single Close, so the left id + right Close pair is
    // present without an empty band in any state.
    expect(bar).toContainElement(screen.getByTestId("issue-close"));
  });

  it("dismisses through the fallback close button in a header-less state (REEF-111)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={onClose} />));

    await user.click(screen.getByTestId("issue-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // REEF-270: the drill trail drives a top-left Back affordance and makes Close
  // exit the whole trail in one shot.
  describe("drill navigation (REEF-270)", () => {
    function renderDrilledInto(issueId: string, onClose = vi.fn()) {
      mockUseActiveVault.mockReturnValue({
        vault: "",
        isLoading: false,
        refetch: () => Promise.resolve(),
      });
      render(wrap(<IssueDetailSheet issueId={issueId} onClose={onClose} />));
      return onClose;
    }

    it("shows no Back affordance when the trail is empty (depth 0)", () => {
      renderDrilledInto("REEF-001");
      expect(screen.queryByTestId("issue-drill-back")).toBeNull();
    });

    it("shows a Back affordance to the previous issue when drilled in", () => {
      // Trail expects REEF-001 on screen, having drilled here from REEF-A, so
      // reconcile keeps the trail (currentId already matches).
      useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-001" });
      renderDrilledInto("REEF-001");

      const back = screen.getByTestId("issue-drill-back");
      expect(back).toHaveAccessibleName("Back to REEF-A");
      expect(back).toHaveAttribute("data-back-to", "REEF-A");
      // Exposed as its own labelled nav landmark, separate from the breadcrumb's
      // "Issue hierarchy" — drill trail vs. structure (AC5).
      const nav = screen.getByRole("navigation", { name: "Back navigation" });
      expect(nav).toContainElement(back);
    });

    it("Back pops one hop and replaces to the previous issue (AC1/AC4)", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({
        trail: ["REEF-A", "REEF-B"],
        currentId: "REEF-001",
      });
      renderDrilledInto("REEF-001");

      await user.click(screen.getByTestId("issue-drill-back"));

      // One hop: REEF-B leaves the trail and we replace to it.
      expect(useIssueNavStack.getState().trail).toEqual(["REEF-A"]);
      expect(mockReplace).toHaveBeenCalledWith("/issues/REEF-B");
    });

    it("Close exits the whole trail in one shot (AC2)", async () => {
      const user = userEvent.setup();
      useIssueNavStack.setState({
        trail: ["REEF-A", "REEF-B"],
        currentId: "REEF-001",
      });
      const onClose = renderDrilledInto("REEF-001");

      await user.click(screen.getByTestId("issue-close"));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useIssueNavStack.getState().trail).toEqual([]);
    });

    it("places Back and Close together in one top chrome row, Back before Close (REEF-284)", () => {
      useIssueNavStack.setState({ trail: ["REEF-A"], currentId: "REEF-001" });
      renderDrilledInto("REEF-001");

      const back = screen.getByTestId("issue-drill-back");
      const close = screen.getByTestId("issue-close");

      // Both affordances live in the same chrome row (a shared ancestor that is
      // not the whole modal), so the history Back and the dismiss Close align on
      // one line instead of Back stacking as a strip above the header.
      const row = back.closest("div");
      expect(row).not.toBeNull();
      expect(row?.contains(close)).toBe(true);

      // Back leads (left), Close follows (right, pushed by ml-auto).
      expect(
        back.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // REEF-375: the detail sheet uses a wider canvas (1200) so the 400px rail's
  // property rows get full width, and `overscroll-contain` stops a scroll at the
  // sheet edge from chaining to the page behind it.
  it("renders a widened, overscroll-contained canvas", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("1200");
    expect(content?.className).toContain("overscroll-contain");
  });
});
