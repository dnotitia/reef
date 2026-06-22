import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/components/RepoPickerSection", () => ({
  RepoPickerSection: () => <section>Repo picker</section>,
}));
vi.mock("@/features/settings/components/ProjectSection", () => ({
  ProjectSection: () => <section>Project section</section>,
}));
vi.mock("@/features/settings/components/AuthoringLanguageSection", () => ({
  AuthoringLanguageSection: () => <section>Authoring language</section>,
}));
vi.mock("@/features/settings/components/ResolvedAutoHideSection", () => ({
  ResolvedAutoHideSection: () => <section>Resolved auto-hide</section>,
}));
vi.mock("@/features/settings/components/TemplatesSection", () => ({
  TemplatesSection: () => <section>Templates</section>,
}));
vi.mock("@/features/settings/components/WorkspaceSkillSection", () => ({
  WorkspaceSkillSection: () => <section>Workspace skill</section>,
}));
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));
vi.mock("@/features/settings/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    role: "owner",
    canEditWorkspace: true,
    isResolving: false,
  }),
}));

import WorkspaceGeneralPage from "./page";

describe("Workspace › General settings page (REEF-183)", () => {
  it("renders the shared workspace settings group scoped to the active vault (REEF-174)", () => {
    render(<WorkspaceGeneralPage />);
    expect(screen.getByTestId("settings-group-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("settings-group-scope")).toHaveTextContent(
      "reef-acme",
    );
  });

  it("titles the group at h2 with the migrated settings at h3 (AC4)", () => {
    render(<WorkspaceGeneralPage />);
    expect(
      screen.getByRole("heading", { name: "General", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Monitored Repositories", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Project", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Authoring Language", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Completed Issues", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Templates", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Workspace AI Instructions",
        level: 3,
      }),
    ).toBeInTheDocument();
  });

  it("shows the editable access badge for a writer", () => {
    render(<WorkspaceGeneralPage />);
    expect(screen.getByTestId("access-badge-editable")).toBeInTheDocument();
  });
});
