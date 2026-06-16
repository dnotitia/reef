import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsGroup } from "./SettingsGroup";

describe("SettingsGroup", () => {
  it("renders the title, description, and children", () => {
    render(
      <SettingsGroup title="Workspace" description="Shared with the team.">
        <p>child</p>
      </SettingsGroup>,
    );
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Shared with the team.")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("shows the access badge when an access level is given", () => {
    render(
      <SettingsGroup title="Workspace" description="x" access="view-only">
        <p>child</p>
      </SettingsGroup>,
    );
    expect(screen.getByTestId("access-badge-view-only")).toBeInTheDocument();
  });

  it("omits the badge while the access level is undefined (role unresolved)", () => {
    render(
      <SettingsGroup title="Workspace" description="x">
        <p>child</p>
      </SettingsGroup>,
    );
    expect(
      screen.queryByTestId("access-badge-view-only"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("access-badge-editable"),
    ).not.toBeInTheDocument();
  });

  it("echoes the scope name beside the title when given (REEF-174)", () => {
    render(
      <SettingsGroup
        title="Workspace settings"
        description="x"
        scopeName="reef-acme"
      >
        <p>child</p>
      </SettingsGroup>,
    );
    const scope = screen.getByTestId("settings-group-scope");
    expect(scope).toHaveTextContent("reef-acme");
    // It is a vault identifier, so it should not be machine-translated.
    expect(scope).toHaveAttribute("translate", "no");
    // The scope name is a sibling of the <h2>, so the heading's accessible
    // name stays exactly the title (not "Workspace settings reef-acme").
    expect(
      screen.getByRole("heading", { name: "Workspace settings", level: 2 }),
    ).toBeInTheDocument();
  });

  it("omits the scope name when none is given (non-workspace groups)", () => {
    render(
      <SettingsGroup title="Your preferences" description="x">
        <p>child</p>
      </SettingsGroup>,
    );
    expect(
      screen.queryByTestId("settings-group-scope"),
    ).not.toBeInTheDocument();
  });
});
