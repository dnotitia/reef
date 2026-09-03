// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(search).toHaveFocus();
  });

  it("draws the search input's ring on pointer and keyboard focus", () => {
    renderSelector();
    fireEvent.click(screen.getByTestId("monitored-repos-trigger"));
    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search.className).toContain("focus:ring-brand-focus");
    expect(search.className).toContain("focus:ring-2");
  });

  it("hides the decorative remove icon on selected-repo chips", () => {
    renderSelector(["acme/app"]);
    const removeIcon = screen
      .getByLabelText("Remove acme/app")
      .querySelector("svg");
    expect(removeIcon).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes each repository option name and pressed state", () => {
    renderSelector(["acme/app"]);
    fireEvent.click(screen.getByTestId("monitored-repos-trigger"));

    const option = screen.getByRole("button", { name: "acme/app" });
    expect(option).toHaveAttribute("aria-label", "acme/app");
    expect(option).toHaveAttribute("aria-pressed", "true");
  });

  it("closes after selecting an option and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <MonitoredRepoSelector
        availableRepos={repos}
        selectedRepos={new Set()}
        onToggle={onToggle}
        isLoading={false}
        isError={false}
      />,
    );

    const trigger = screen.getByTestId("monitored-repos-trigger");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "acme/app" }));

    expect(onToggle).toHaveBeenCalledWith("acme/app");
    expect(
      screen.queryByRole("dialog", { name: "Search repositories" }),
    ).not.toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(trigger).toHaveFocus();
  });

  it("keeps long selected repository chips shrinkable with a persistent remove action", () => {
    const fullName = "very-long-organization-name/very-long-repository-name";
    render(
      <MonitoredRepoSelector
        availableRepos={[{ full_name: fullName, id: 1 }]}
        selectedRepos={new Set([fullName])}
        onToggle={vi.fn()}
        isLoading={false}
        isError={false}
      />,
    );

    const remove = screen.getByRole("button", { name: `Remove ${fullName}` });
    const chip = remove.parentElement;
    expect(chip).toHaveClass("min-w-0", "max-w-full");
    expect(remove).toHaveClass("shrink-0");
    expect(screen.getByText(fullName)).toHaveClass("truncate");
  });

  it("contains the loading skeleton to the available width", () => {
    render(
      <MonitoredRepoSelector
        availableRepos={repos}
        selectedRepos={new Set()}
        onToggle={vi.fn()}
        isLoading
        isError={false}
      />,
    );

    expect(screen.getByTestId("monitored-repos-loading")).toHaveClass(
      "w-full",
      "max-w-64",
    );
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
