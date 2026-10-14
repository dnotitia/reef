import { describe, expect, it, vi } from "vitest";
import { scrollOptionIntoView } from "./scrollOptionIntoView";

/** A stand-in element whose rect and (writable) scrollTop we fully control. */
function fakeElement(
  rect: { top: number; bottom: number },
  scrollTop = 0,
): HTMLElement {
  return {
    scrollTop,
    getBoundingClientRect: () =>
      ({ top: rect.top, bottom: rect.bottom }) as DOMRect,
  } as unknown as HTMLElement;
}

describe("scrollOptionIntoView", () => {
  it("scrolls the list down when the option sits below the container viewport", () => {
    const container = fakeElement({ top: 0, bottom: 100 }, 0);
    const option = fakeElement({ top: 120, bottom: 140 });
    scrollOptionIntoView(container, option);
    // bottom overflow = 140 - 100 → list advances by 40, nothing else moves.
    expect(container.scrollTop).toBe(40);
  });

  it("scrolls the list up when the option sits above the container viewport", () => {
    const container = fakeElement({ top: 50, bottom: 150 }, 60);
    const option = fakeElement({ top: 30, bottom: 45 });
    scrollOptionIntoView(container, option);
    // top overflow = 50 - 30 = 20 → 60 - 20 = 40.
    expect(container.scrollTop).toBe(40);
  });

  it("leaves scrollTop unchanged when the option is already fully visible", () => {
    const container = fakeElement({ top: 0, bottom: 100 }, 25);
    const option = fakeElement({ top: 20, bottom: 60 });
    scrollOptionIntoView(container, option);
    expect(container.scrollTop).toBe(25);
  });

  it.each([
    [{ top: 0, bottom: 100 }, { top: 120, bottom: 140 }, 0, 40],
    [{ top: 50, bottom: 150 }, { top: 30, bottom: 45 }, 60, 40],
  ])(
    "keeps overflow scrolling inside its list (REEF-145)",
    (listRect, optionRect, initialScroll, expectedScroll) => {
      const spy = vi.spyOn(Element.prototype, "scrollIntoView");
      const container = document.createElement("div");
      const option = document.createElement("div");
      container.appendChild(option);
      container.scrollTop = initialScroll;
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
        listRect as DOMRect,
      );
      vi.spyOn(option, "getBoundingClientRect").mockReturnValue(
        optionRect as DOMRect,
      );
      try {
        scrollOptionIntoView(container, option);
        expect(container.scrollTop).toBe(expectedScroll);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  it("no-ops when the container or option is missing", () => {
    expect(() => scrollOptionIntoView(null, null)).not.toThrow();
    expect(() =>
      scrollOptionIntoView(undefined, fakeElement({ top: 0, bottom: 1 })),
    ).not.toThrow();
  });
});
