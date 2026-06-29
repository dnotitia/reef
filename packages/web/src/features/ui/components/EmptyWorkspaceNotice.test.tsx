import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The notice now resolves the active vault (REEF-315) via useActiveVault, which
// calls useQuery. This is the "no workspace selected" surface, so resolve it to
// the empty vault — withVault("", "/settings") stays the bare "/settings" link.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "", isLoading: false, refetch: vi.fn() }),
}));

import { EmptyWorkspaceNotice } from "./EmptyWorkspaceNotice";

describe("EmptyWorkspaceNotice", () => {
  // The done-check for REEF-259: the five no-vault surfaces share one notice, so
  // the canonical copy, the brand Settings link, and the testid the callers gate
  // on all live here in one place.
  it("renders the single canonical copy under the shared testid", () => {
    render(
      <IntlTestProvider>
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("empty-workspace-notice")).toBeInTheDocument();
    expect(screen.getByText(/Pick a workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/to get started\./i)).toBeInTheDocument();
  });

  it("links to Settings as a brand-styled client link", () => {
    render(
      <IntlTestProvider>
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link.className).toContain("text-brand");
  });

  // REEF-293 AC1: the same notice renders in Korean under the ko catalog, with
  // the embedded Settings link preserved (t.rich) and reordered to the front.
  it("renders the Korean copy and a translated Settings link under ko", () => {
    render(
      <IntlTestProvider locale="ko">
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("empty-workspace-notice")).toHaveTextContent(
      "설정에서 워크스페이스를 선택해 시작하세요.",
    );
    const link = screen.getByRole("link", { name: "설정" });
    expect(link).toHaveAttribute("href", "/settings");
  });
});
