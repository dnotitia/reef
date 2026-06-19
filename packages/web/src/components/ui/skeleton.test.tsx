import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("defaults to the primary tone", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-tone", "primary");
    // The sweep + fills live on `.reef-shimmer` in globals.css.
    expect(el).toHaveClass("reef-shimmer");
  });

  it("encodes the fainter hierarchy through tone=secondary", () => {
    const { container } = render(<Skeleton tone="secondary" />);
    expect(container.firstElementChild).toHaveAttribute(
      "data-tone",
      "secondary",
    );
  });

  it("forwards sizing className and the sweep index via style", () => {
    const { container } = render(
      <Skeleton
        className="h-8 w-12"
        style={{ "--i": 4 } as React.CSSProperties}
      />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("h-8", "w-12");
    expect(el.style.getPropertyValue("--i")).toBe("4");
  });
});
