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
