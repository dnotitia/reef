import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button focus indicator", () => {
  it("uses a solid foreground outline with at least two pixels of visible chrome", () => {
    render(<Button>Clear filters</Button>);

    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-foreground",
      "focus-visible:outline-offset-1",
    );
  });
});
