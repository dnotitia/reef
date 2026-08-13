import { act, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverflowMeasurement } from "./overflowTooltip";

function MeasurementProbe({
  text,
  geometry = "fit",
}: {
  text: string;
  geometry?: "fit" | "overflow";
}) {
  const targetRef = useRef<HTMLSpanElement>(null);
  const overflowing = useOverflowMeasurement(targetRef, text);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    Object.defineProperties(target, {
      clientWidth: {
        configurable: true,
        value: geometry === "overflow" ? 64 : 260,
      },
      scrollWidth: {
        configurable: true,
        value: 240,
      },
    });
  }, [geometry]);

  return (
    <span>
      <span ref={targetRef} data-testid="measurement-target">
        {text}
      </span>
      <span data-testid="measurement-state">
        {overflowing ? "overflow" : "fit"}
      </span>
    </span>
  );
}

describe("useOverflowMeasurement", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("uses real geometry and converges after text and container changes", async () => {
    const callbacks: Array<() => void> = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(() => callback([], this as unknown as ResizeObserver));
      }

      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const { rerender } = render(<MeasurementProbe text="Long value" />);
    const target = screen.getByTestId("measurement-target");

    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 64 },
      scrollWidth: { configurable: true, value: 240 },
    });
    await act(async () => {
      callbacks.forEach((callback) => callback());
    });
    expect(screen.getByTestId("measurement-state")).toHaveTextContent(
      "overflow",
    );

    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 260 },
      scrollWidth: { configurable: true, value: 240 },
    });
    await act(async () => {
      callbacks.forEach((callback) => callback());
    });
    expect(screen.getByTestId("measurement-state")).toHaveTextContent("fit");

    rerender(<MeasurementProbe text="A replacement" />);
    expect(screen.getByTestId("measurement-state")).toHaveTextContent("fit");
  });

  it("rechecks geometry after a parent render settles", () => {
    const callbacks: Array<() => void> = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(() => callback([], this as unknown as ResizeObserver));
      }

      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      const { rerender } = render(
        <MeasurementProbe text="Long value" geometry="fit" />,
      );

      expect(screen.getByTestId("measurement-state")).toHaveTextContent(
        "fit",
      );

      rerender(<MeasurementProbe text="Long value" geometry="overflow" />);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId("measurement-state")).toHaveTextContent(
        "overflow",
      );

      rerender(<MeasurementProbe text="Long value" geometry="fit" />);
      act(() => callbacks.forEach((callback) => callback()));
      expect(screen.getByTestId("measurement-state")).toHaveTextContent(
        "fit",
      );
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
