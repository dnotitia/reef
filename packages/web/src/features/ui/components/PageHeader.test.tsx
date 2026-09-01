import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it('marks the description subtitle translate="no" so the vault / @login identifier is not machine-translated (REEF-260)', () => {
    render(<PageHeader title="Issues" description="reef-acme" />);
    // The subtitle is the workspace name (or `@login` on My Work) — an
    // identifier, not prose, so it opts out of machine translation.
    expect(screen.getByText("reef-acme")).toHaveAttribute("translate", "no");
  });

  it("leaves the title translatable — only the identifier subtitle is protected (REEF-260)", () => {
    render(<PageHeader title="Issues" description="reef-acme" />);
    expect(
      screen.getByRole("heading", { name: "Issues", level: 1 }),
    ).not.toHaveAttribute("translate");
  });

  it("renders the description text as the header subtitle", () => {
    render(<PageHeader title="Reports" description="reef-acme" />);
    expect(screen.getByText("reef-acme")).toBeInTheDocument();
  });

  it("uses the canonical page-title role without an inline tracking override", () => {
    render(<PageHeader title="Issues" />);
    const heading = screen.getByRole("heading", { name: "Issues", level: 1 });
    expect(heading).toHaveClass("type-page-title");
    expect(heading).not.toHaveAttribute("style");
  });

  it("renders a title-adjacent control outside the right action slot", () => {
    render(
      <PageHeader
        title="Issues"
        titleAdjacent={<button type="button">Scope</button>}
        actions={<button type="button">View</button>}
      />,
    );

    const scope = screen.getByRole("button", { name: "Scope" });
    const view = screen.getByRole("button", { name: "View" });
    expect(
      scope.closest('[data-slot="page-header-title-adjacent"]'),
    ).not.toBeNull();
    expect(scope.closest('[data-slot="page-header-actions"]')).toBeNull();
    expect(view.closest('[data-slot="page-header-actions"]')).not.toBeNull();
  });

  it("lets a node subtitle own its translation boundaries so mixed prose still translates (REEF-260)", () => {
    // My Work's `@login · N open` mixes an identifier with a prose count, so it
    // passes a node that protects the identifier while the prose is not
    // frozen by a blanket translate="no" on the whole subtitle.
    render(
      <PageHeader
        title="My Work"
        description={
          <>
            <span translate="no">@alice</span>
            {" · 3 open"}
          </>
        }
      />,
    );
    // The identifier the caller wrapped stays protected...
    expect(screen.getByText("@alice")).toHaveAttribute("translate", "no");
    // ...but the prose count label is not under any translate="no" element.
    expect(screen.getByText(/open/).closest("[translate='no']")).toBeNull();
  });
});
