import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/components/AiConfigurationStatus", () => ({
  AiConfigurationStatus: () => <section>AI status</section>,
}));

import DeploymentSettingsPage from "./page";

describe("Settings › Deployment page (REEF-183)", () => {
  it("renders the operator-managed AI configuration group (AC4)", () => {
    render(<DeploymentSettingsPage />);
    expect(
      screen.getByRole("heading", { name: "Deployment", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "AI Configuration", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("access-badge-managed")).toBeInTheDocument();
    expect(screen.getByText("AI status")).toBeInTheDocument();
  });

  it("does not mount the Active Workspace selector — Deployment is not workspace-scoped (AC2)", () => {
    render(<DeploymentSettingsPage />);
    expect(
      screen.queryByTestId("active-workspace-section"),
    ).not.toBeInTheDocument();
  });
});
