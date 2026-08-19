import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The notice now resolves the active vault (REEF-315) via useActiveVault, which
// calls useQuery. This is the "no workspace selected" surface, so resolve it to
// the empty vault — links without a selected workspace go to onboarding.
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "", isLoading: false, refetch: vi.fn() }),
}));

import { EmptyWorkspaceNotice } from "./EmptyWorkspaceNotice";

describe("EmptyWorkspaceNotice", () => {
  // The done-check for REEF-259: the five no-vault surfaces share one notice, so
  // the canonical copy, the brand Onboarding link, and the testid the callers gate
  // on all live here in one place.
  it("renders the single canonical copy under the shared testid", () => {
    render(
      <IntlTestProvider>
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    const notice = screen.getByTestId("empty-workspace-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveClass(
      "flex",
      "flex-1",
      "items-center",
      "justify-center",
      "px-6",
      "py-12",
    );
    expect(notice.tagName).toBe("DIV");
    expect(notice).not.toHaveAttribute("role", "region");
    expect(notice).not.toHaveClass("rounded-lg", "border-dashed");
    expect(screen.getByText(/Choose a workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/to get started\./i)).toBeInTheDocument();
  });

  it("links to Onboarding as a brand-styled client link", () => {
    render(
      <IntlTestProvider>
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    const link = screen.getByRole("link", { name: "Onboarding" });
    expect(link).toHaveAttribute("href", "/onboarding");
    expect(link.className).toContain("text-brand");
  });

  // REEF-293 AC1: the same notice renders in Korean under the ko catalog, with
  // the embedded Onboarding link preserved (t.rich) and reordered to the front.
  it("renders the Korean copy and a translated Onboarding link under ko", () => {
    render(
      <IntlTestProvider locale="ko">
        <EmptyWorkspaceNotice />
      </IntlTestProvider>,
    );

    expect(screen.getByTestId("empty-workspace-notice")).toHaveTextContent(
      "온보딩에서 워크스페이스를 선택해 시작하세요.",
    );
    const link = screen.getByRole("link", { name: "온보딩" });
    expect(link).toHaveAttribute("href", "/onboarding");
  });
});
