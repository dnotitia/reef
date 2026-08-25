import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { OverflowTooltip, useTextOverflow } from "./overflow-tooltip";

function OverflowProbe({
  value,
  enabled = true,
}: {
  value: string;
  enabled?: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const isOverflowing = useTextOverflow(textRef, value, enabled);
  return (
    <>
      <span ref={textRef} data-testid="measured-text">
        {value}
      </span>
      <output data-testid="overflow-state">{String(isOverflowing)}</output>
    </>
  );
}

describe("overflow tooltip policy", () => {
  it("uses rendered geometry and rechecks when the viewport or text changes", async () => {
    const { rerender } = render(<OverflowProbe value="A long value" />);
    const text = screen.getByTestId("measured-text");
    const state = screen.getByTestId("overflow-state");

    Object.defineProperty(text, "clientWidth", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(text, "scrollWidth", {
      configurable: true,
      value: 240,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(state).toHaveTextContent("true"));

    Object.defineProperty(text, "clientWidth", {
      configurable: true,
      value: 320,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(state).toHaveTextContent("false"));

    rerender(<OverflowProbe value="A different long value" />);
    const changedText = screen.getByTestId("overflow-state");
    const changedMeasuredText = screen.getByTestId("measured-text");
    Object.defineProperty(changedMeasuredText, "clientWidth", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(changedMeasuredText, "scrollWidth", {
      configurable: true,
      value: 240,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(changedText).toHaveTextContent("true"));

    rerender(<OverflowProbe value="A different long value" enabled={false} />);
    expect(screen.getByTestId("overflow-state")).toHaveTextContent("false");
  });

  it("does not mount a tooltip for a fitting value and exposes the full value when eligible", async () => {
    const { rerender } = render(
      <OverflowTooltip value="Full source value" isOverflowing={false} active>
        <button type="button">Visible value</button>
      </OverflowTooltip>,
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-describedby");

    rerender(
      <OverflowTooltip value="Full source value" isOverflowing active>
        <button type="button">Visible value</button>
      </OverflowTooltip>,
    );

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Full source value",
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby");
  });

  it("keeps the shared tooltip above the relation dropdown overlay", async () => {
    render(
      <div className="z-[100]">
        <OverflowTooltip value="Full source value" isOverflowing active>
          <button type="button">Visible value</button>
        </OverflowTooltip>
      </div>,
    );

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveClass("z-[110]");
    expect(tooltip).toHaveAttribute("data-reef-tooltip-content", "true");
    expect(tooltip.parentElement).toHaveAttribute(
      "data-radix-popper-content-wrapper",
      "",
    );
  });
});
