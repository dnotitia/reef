// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitoredRepoSelector } from "./MonitoredRepoSelector";

const repos = [{ full_name: "acme/app", id: 1 }];

function renderSelector(selected: string[] = []) {
  return render(
    <MonitoredRepoSelector
      availableRepos={repos}
      selectedRepos={new Set(selected)}
      onToggle={vi.fn()}
      isLoading={false}
      isError={false}
    />,
  );
}

describe("MonitoredRepoSelector accessibility (REEF-151)", () => {
  it("uses a typographic ellipsis in the empty trigger label", () => {
    renderSelector();
    expect(screen.getByText("Select repositories…")).toBeInTheDocument();
  });

  it("hides the decorative chevron from assistive tech", () => {
    renderSelector();
    const chevron = screen
      .getByTestId("monitored-repos-trigger")
      .querySelector("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
  });

  it("gives the search input an accessible name and an ellipsis placeholder", () => {
    renderSelector();
    fireEvent.click(screen.getByTestId("monitored-repos-trigger"));
    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search).toHaveAttribute("placeholder", "Search repositories…");
  });

  it("draws the search input's ring on keyboard focus only (REEF-226)", () => {
    renderSelector();
    fireEvent.click(screen.getByTestId("monitored-repos-trigger"));
    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search.className).toContain("focus-visible:ring-brand/30");
    expect(search.className).not.toContain("focus:ring");
  });

  it("hides the decorative remove icon on selected-repo chips", () => {
    renderSelector(["acme/app"]);
    const removeIcon = screen
      .getByLabelText("Remove acme/app")
      .querySelector("svg");
    expect(removeIcon).toHaveAttribute("aria-hidden", "true");
  });
});

/**
 * REEF-236: errorMessage is a ReactNode so the caller can route the user
 * somewhere actionable (e.g. a link to the Preferences tab) instead of a dead
 * string.
 */
describe("MonitoredRepoSelector error message (REEF-236)", () => {
  it("renders a ReactNode errorMessage verbatim", () => {
    render(
      <MonitoredRepoSelector
        availableRepos={repos}
        selectedRepos={new Set()}
        onToggle={vi.fn()}
        isLoading={false}
        isError
        errorMessage={<a href="/settings/preferences">Preferences tab</a>}
      />,
    );
    const link = screen.getByRole("link", { name: "Preferences tab" });
    expect(link).toHaveAttribute("href", "/settings/preferences");
  });
});
