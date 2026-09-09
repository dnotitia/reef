import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DeploymentSettingsLoading,
  MembersSettingsLoading,
  PreferencesSettingsLoading,
  WorkspaceSettingsLoading,
} from "./SettingsLoadingSkeleton";

describe("Settings loading surfaces", () => {
  it("keeps Workspace group, subtab, and section labels while values load", () => {
    render(<WorkspaceSettingsLoading />);

    expect(
      screen.getByRole("heading", { name: "Active Workspace", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "General", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    for (const label of [
      "Monitored Repositories",
      "Project",
      "Authoring Language",
      "Completed Issues",
      "Templates",
      "Workspace AI Instructions",
    ]) {
      expect(
        screen.getByRole("heading", { name: label, level: 3 }),
      ).toBeInTheDocument();
    }
  });

  it("keeps personal preference section labels without exposing values", () => {
    render(<PreferencesSettingsLoading />);

    expect(
      screen.getByRole("heading", { name: "Your preferences", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Appearance", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Language", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("keeps the managed deployment group and AI section label", () => {
    render(<DeploymentSettingsLoading />);

    expect(
      screen.getByRole("heading", { name: "Deployment", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "AI Configuration", level: 3 }),
    ).toBeInTheDocument();
  });

  it("keeps the member scope and group labels without assuming roster or permissions", () => {
    render(<MembersSettingsLoading />);

    expect(screen.getByText("Active Workspace")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Members", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add member/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("You can edit")).not.toBeInTheDocument();
  });
});
