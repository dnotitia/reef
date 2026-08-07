import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared hook so the toggle is exercised in isolation from Dexie/store.
const setThemeMock = vi.fn(async () => {});
const themeRef = { current: "system" as "light" | "dark" | "system" };
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: themeRef.current, setTheme: setThemeMock }),
}));

import { AccountThemeToggle } from "./AccountThemeToggle";

function renderToggle() {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuContent>
        <AccountThemeToggle />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("AccountThemeToggle", () => {
  beforeEach(() => {
    setThemeMock.mockClear();
    themeRef.current = "system";
  });

  afterEach(() => {
    themeRef.current = "system";
  });

  it("renders the three theme choices as a labelled radio group", () => {
    renderToggle();
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByTestId("account-theme-light")).toBeInTheDocument();
    expect(screen.getByTestId("account-theme-dark")).toBeInTheDocument();
    expect(screen.getByTestId("account-theme-system")).toBeInTheDocument();
  });

  it("marks the current preference via aria-checked", () => {
    themeRef.current = "dark";
    renderToggle();
    expect(screen.getByTestId("account-theme-dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("account-theme-system")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls setTheme with the clicked choice", async () => {
    renderToggle();
    fireEvent.click(screen.getByTestId("account-theme-light"));
    await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith("light"));
  });
});
