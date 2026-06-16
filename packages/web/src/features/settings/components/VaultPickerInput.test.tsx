// @vitest-environment jsdom
import type { EnrichedVaultSummary } from "@reef/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultPickerInput } from "./VaultPickerInput";

const vaults: EnrichedVaultSummary[] = [
  { name: "reef-acme", has_reef_config: true },
];

function renderPicker(value = "") {
  return render(
    <VaultPickerInput
      vaults={vaults}
      value={value}
      onChange={vi.fn()}
      isLoading={false}
      isError={false}
    />,
  );
}

describe("VaultPickerInput accessibility (REEF-151)", () => {
  it("uses a typographic ellipsis in the empty trigger placeholder", () => {
    renderPicker();
    expect(screen.getByText("Select workspace…")).toBeInTheDocument();
  });

  it("hides the decorative caret from assistive tech", () => {
    renderPicker();
    expect(screen.getByText("▾")).toHaveAttribute("aria-hidden", "true");
  });

  it("gives the search input an accessible name and an ellipsis placeholder", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("active-vault-trigger"));
    const search = screen.getByRole("textbox", { name: "Search workspaces" });
    expect(search).toHaveAttribute("placeholder", "Search workspaces…");
  });

  it("draws the search input's ring on keyboard focus only (REEF-226)", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("active-vault-trigger"));
    const search = screen.getByRole("textbox", { name: "Search workspaces" });
    expect(search.className).toContain("focus-visible:ring-brand/30");
    expect(search.className).not.toContain("focus:ring");
  });
});
