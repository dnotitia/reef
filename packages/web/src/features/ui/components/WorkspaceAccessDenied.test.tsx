import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { EnrichedVaultSummary } from "@reef/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceAccessDenied } from "./WorkspaceAccessDenied";

function vault(name: string, hasReefConfig: boolean): EnrichedVaultSummary {
  return {
    name,
    has_reef_config: hasReefConfig,
  } as EnrichedVaultSummary;
}

function renderDenied(vaults: EnrichedVaultSummary[], denied = "reef-other") {
  return render(
    <IntlTestProvider>
      <WorkspaceAccessDenied vault={denied} vaults={vaults} />
    </IntlTestProvider>,
  );
}

describe("WorkspaceAccessDenied (REEF-315 AC5)", () => {
  it("lists only the user's reef workspaces as switch links", () => {
    renderDenied([vault("reef-acme", true), vault("raw", false)]);

    const link = screen.getByTestId("access-denied-workspace-reef-acme");
    expect(link).toHaveAttribute("href", "/workspace/reef-acme/issues");
    // Non-reef vaults are not offered as switch targets.
    expect(
      screen.queryByTestId("access-denied-workspace-raw"),
    ).not.toBeInTheDocument();
    // No silent fallback: the onboarding CTA appears when there are no
    // reef workspaces to switch to.
    expect(
      screen.queryByTestId("access-denied-onboarding"),
    ).not.toBeInTheDocument();
  });

  it("offers an onboarding path when the user has no reef workspaces", () => {
    renderDenied([vault("raw", false)]);

    const cta = screen.getByTestId("access-denied-onboarding");
    expect(cta).toHaveAttribute("href", "/onboarding");
    expect(
      screen.queryByTestId("access-denied-workspace-raw"),
    ).not.toBeInTheDocument();
  });
});
