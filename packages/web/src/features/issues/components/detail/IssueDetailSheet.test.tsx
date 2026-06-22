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

const { mockUseActiveVault } = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
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

  // REEF-149: the detail sheet uses a wider canvas (1080) so the rail's property
  // rows get full width, and `overscroll-contain` stops a scroll at the sheet
  // edge from chaining to the page behind it.
  it("renders a widened, overscroll-contained canvas", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssueDetailSheet issueId="REEF-001" onClose={() => {}} />));

    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("1080");
    expect(content?.className).toContain("overscroll-contain");
  });
});
