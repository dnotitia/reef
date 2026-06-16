import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/components/ActiveWorkspaceSection", () => ({
  ActiveWorkspaceSection: () => (
    <section data-testid="active-workspace-section">Active workspace</section>
  ),
}));
vi.mock("@/features/settings/components/WorkspaceSubNav", () => ({
  WorkspaceSubNav: () => <nav data-testid="workspace-subnav">Sub-nav</nav>,
}));

import WorkspaceSettingsLayout from "./layout";

describe("Workspace settings layout (REEF-183)", () => {
  it("mounts the Active Workspace selector above the General/Members sub-nav and content (AC2, AC3)", () => {
    render(
      <WorkspaceSettingsLayout>
        <div data-testid="tab-content">content</div>
      </WorkspaceSettingsLayout>,
    );

    const selector = screen.getByTestId("active-workspace-section");
    const subnav = screen.getByTestId("workspace-subnav");
    const content = screen.getByTestId("tab-content");

    // The single selector sits above both sub-views so one choice scopes them
    // together (AC3); it is not buried inside one of the rows (REEF-150).
    expect(
      selector.compareDocumentPosition(subnav) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      subnav.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the active sub-view content", () => {
    render(
      <WorkspaceSettingsLayout>
        <div data-testid="tab-content">content</div>
      </WorkspaceSettingsLayout>,
    );
    expect(screen.getByTestId("tab-content")).toHaveTextContent("content");
  });
});
