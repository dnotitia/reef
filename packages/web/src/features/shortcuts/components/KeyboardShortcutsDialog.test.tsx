import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShortcutsStore } from "../stores/useShortcutsStore";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

describe("KeyboardShortcutsDialog", () => {
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    window.navigator,
    "userAgent",
  );

  beforeEach(() => {
    useShortcutsStore.setState({ isOpen: false });
  });

  afterEach(() => {
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, "userAgent", originalUserAgent);
    }
  });

  it("does not render content when closed", () => {
    render(<KeyboardShortcutsDialog />);
    expect(
      screen.queryByTestId("keyboard-shortcuts-dialog"),
    ).not.toBeInTheDocument();
  });

  it("lists every declared shortcut when open", () => {
    useShortcutsStore.setState({ isOpen: true });
    render(<KeyboardShortcutsDialog />);
    const rows = screen.getAllByTestId("shortcut-row");
    const labels = rows.map((el) => el.getAttribute("data-shortcut-label"));
    expect(labels).toEqual(
      expect.arrayContaining([
        "Open global search",
        "Show keyboard shortcuts",
        "New issue",
        "Toggle Ask AI",
      ]),
    );
  });

  it("renders macOS key glyphs when the user agent looks like a Mac", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      configurable: true,
    });
    useShortcutsStore.setState({ isOpen: true });
    render(<KeyboardShortcutsDialog />);
    // ⌘ should appear at least once (mod key).
    expect(screen.getAllByText("⌘").length).toBeGreaterThan(0);
  });

  it("renders Ctrl when the user agent is non-Mac", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    useShortcutsStore.setState({ isOpen: true });
    render(<KeyboardShortcutsDialog />);
    expect(screen.getAllByText("Ctrl").length).toBeGreaterThan(0);
  });
});
