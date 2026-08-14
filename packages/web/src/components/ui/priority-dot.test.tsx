import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PriorityBadge, PriorityOption } from "./priority-dot";

function renderWithIntl(node: ReactNode) {
  return render(<IntlTestProvider>{node}</IntlTestProvider>);
}

describe("PriorityOption", () => {
  it("uses the priority badge typography for both unset and real options", () => {
    renderWithIntl(
      <>
        <PriorityOption priority={null} />
        <PriorityOption priority="high" />
      </>,
    );

    expect(screen.getByText("No priority").parentElement).toHaveClass(
      "text-xs",
      "text-foreground/80",
    );
    expect(screen.getByText("High").parentElement).toHaveClass(
      "text-xs",
      "text-foreground/80",
    );
  });

  it("omits the dot only for the unset select option", () => {
    const { container } = renderWithIntl(<PriorityOption priority={null} />);
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();

    const real = renderWithIntl(<PriorityOption priority="high" />);
    expect(real.container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("preserves the existing neutral dot for non-select badges", () => {
    const { container } = renderWithIntl(<PriorityBadge priority={null} />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
