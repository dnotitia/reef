import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyWorkspaceNotice } from "./EmptyWorkspaceNotice";

describe("EmptyWorkspaceNotice", () => {
  // The done-check for REEF-259: the five no-vault surfaces share one notice, so
  // the canonical copy, the brand Settings link, and the testid the callers gate
  // on all live here in one place.
  it("renders the single canonical copy under the shared testid", () => {
    render(<EmptyWorkspaceNotice />);

    expect(screen.getByTestId("empty-workspace-notice")).toBeInTheDocument();
    expect(screen.getByText(/Pick a workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/to get started\./i)).toBeInTheDocument();
  });

  it("links to Settings as a brand-styled client link", () => {
    render(<EmptyWorkspaceNotice />);

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link.className).toContain("text-brand");
  });
});
