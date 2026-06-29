import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SettingsLoading from "./loading";

describe("settings loading.tsx", () => {
  it("renders a settings content skeleton under the tabs (REEF-255)", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("settings-skeleton")).toBeInTheDocument();
  });

  it("hides the decorative groups and announces loading to assistive tech (REEF-281)", () => {
    const { container } = render(<SettingsLoading />);

    // The settings-group placeholders are decorative — aria-hidden so a screen
    // reader skips the empty DOM.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    // The role=status loading announcement is a sibling, not under aria-hidden.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });
});
