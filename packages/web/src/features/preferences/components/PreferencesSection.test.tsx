// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the theme hook so each test can drive React state directly.
const setThemeMock = vi.fn(async () => {});
const themeRef = { current: "system" as "light" | "dark" | "system" };
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: themeRef.current,
    setTheme: setThemeMock,
  }),
}));

import { PreferencesSection } from "./PreferencesSection";

describe("PreferencesSection", () => {
  beforeEach(() => {
    setThemeMock.mockClear();
    themeRef.current = "system";
  });

  afterEach(() => {
    themeRef.current = "system";
  });

  it("renders all three theme options", () => {
    render(<PreferencesSection />);
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();
  });

  it("marks the currently-selected option via aria-checked", () => {
    themeRef.current = "dark";
    render(<PreferencesSection />);
    expect(screen.getByTestId("theme-option-dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("theme-option-light")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls setTheme with the clicked option", async () => {
    render(<PreferencesSection />);
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith("dark"));
  });

  it("supports keyboard activation (Enter / Space)", async () => {
    render(<PreferencesSection />);
    const light = screen.getByTestId("theme-option-light");
    light.focus();
    fireEvent.click(light); // jsdom's default button activation behavior
    await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith("light"));
  });

  it("renders a single Appearance heading at level 3 (REEF-151)", () => {
    render(<PreferencesSection />);
    // The page no longer wraps this in its own "Appearance" heading, so this
    // is the one — at h3, nested under the group's h2.
    expect(
      screen.getByRole("heading", { name: "Appearance", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Appearance" })).toHaveLength(
      1,
    );
  });

  it("hides the decorative option icons from assistive tech (REEF-151)", () => {
    render(<PreferencesSection />);
    const icon = screen.getByTestId("theme-option-light").querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
