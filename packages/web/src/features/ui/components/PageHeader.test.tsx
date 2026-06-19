import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it('marks the description subtitle translate="no" so the vault / @login identifier is not machine-translated (REEF-260)', () => {
    render(<PageHeader title="Issues" description="reef-acme" />);
    // The subtitle is the workspace name (or `@login` on My Work) — an
    // identifier, never prose — so it must opt out of machine translation.
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
});
