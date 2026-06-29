import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/preferences/components/PreferencesSection", () => ({
  PreferencesSection: () => <section>Preferences</section>,
}));

// LanguageSection consumes next-intl (useTranslations) + the locale store; this
// page-layout test focuses on the group's structure, so stub it like
// PreferencesSection. Its own behavior is covered in LanguageSection.test.tsx.
vi.mock("@/features/preferences/components/LanguageSection", () => ({
  LanguageSection: () => <section>Language</section>,
}));

import PreferencesPage from "./page";

describe("PreferencesPage layout", () => {
  it("is a personal, browser-local group with no GitHub PAT surface (REEF-244)", () => {
    render(<PreferencesPage />);

    expect(
      screen.getByRole("heading", {
        name: "Your preferences",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GitHub Access Token" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("GitHub Personal Access Token"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("disconnect-btn")).not.toBeInTheDocument();
  });

  it("does not render its own Appearance heading (PreferencesSection owns it)", () => {
    render(<PreferencesPage />);
    expect(
      screen.queryByRole("heading", { name: "Appearance" }),
    ).not.toBeInTheDocument();
  });

  it("does not mount the Active Workspace selector - Preferences is not workspace-scoped (AC2)", () => {
    render(<PreferencesPage />);
    expect(
      screen.queryByTestId("active-workspace-section"),
    ).not.toBeInTheDocument();
  });
});
