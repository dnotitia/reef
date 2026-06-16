// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "./textarea";

/**
 * REEF-226: the Textarea primitive shares the input-family focus ring (brand
 * border + brand/30 ring on focus-visible) instead of the stock shadcn
 * ring-ring + ring-offset-2. The offset pushed the ring further outside the box,
 * making it more prone to clipping inside overflow-x-clip containers.
 */
describe("Textarea focus ring (REEF-226)", () => {
  it("uses the brand focus-visible ring and drops the clipping-prone offset", () => {
    const { getByRole } = render(<Textarea aria-label="notes" />);
    const el = getByRole("textbox");
    expect(el.className).toContain("focus-visible:border-brand");
    expect(el.className).toContain("focus-visible:ring-brand/30");
    expect(el.className).not.toContain("ring-offset-2");
    expect(el.className).not.toContain("focus-visible:ring-ring");
  });
});
