// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "./textarea";

/**
 * Textarea uses the input-family context ring on every focus entry, including
 * pointer entry, instead of the stock shadcn ring-offset treatment. Keeping
 * the ring inset avoids clipping inside overflow-x-clip containers.
 */
describe("Textarea focus ring (REEF-226)", () => {
  it("uses the solid brand focus ring and drops the clipping-prone offset", () => {
    const { getByRole } = render(<Textarea aria-label="notes" />);
    const el = getByRole("textbox");
    expect(el.className).toContain("focus:border-brand-focus");
    expect(el.className).toContain("focus:ring-2");
    expect(el.className).toContain("focus:ring-inset");
    expect(el.className).toContain("focus:ring-brand-focus");
    expect(el.className).not.toContain("ring-offset-2");
    expect(el.className).not.toContain("focus-visible:ring-brand-focus");
  });
});
