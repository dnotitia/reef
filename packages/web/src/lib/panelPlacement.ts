export type VerticalPlacement = "down" | "up";
export type HorizontalPlacement = "start" | "end";

export interface PanelPlacement {
  vertical: VerticalPlacement;
  horizontal: HorizontalPlacement;
}

interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface PanelSize {
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

export interface PlacementBoundary {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const SCROLL_BOUNDARY_OVERFLOWS = new Set([
  "auto",
  "scroll",
  "hidden",
  "clip",
  "overlay",
]);

/**
 * Find the nearest ancestor that can clip or scroll a non-portaled panel.
 * Absolute-positioned descendants can otherwise extend that ancestor's
 * scrollable overflow, which is the dialog/sheet scrollbar class this placement
 * helper is meant to avoid.
 */
export function findScrollBoundaryRect(
  element: HTMLElement | null,
): PlacementBoundary | null {
  if (
    !element ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return null;
  }

  let current = element.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      [style.overflow, style.overflowX, style.overflowY].some((value) =>
        SCROLL_BOUNDARY_OVERFLOWS.has(value),
      )
    ) {
      const rect = current.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Choose which corner a non-portaled dropdown panel opens from so it stays on
 * screen — without ever scrolling an ancestor (REEF-145).
 *
 * The panel is anchored under (or over) its trigger inside the page flow, so the
 * old behaviour leaned on `scrollIntoView` dragging the surrounding scroll
 * container (the issue detail sheet) to reveal an offscreen panel. Instead we
 * flip the panel's anchor when the preferred corner would spill past the
 * active boundary edge (viewport by default; a clipped/scrolling ancestor when
 * provided):
 *   - vertical: open downward by default, flip up when the panel would run
 *     past the bottom AND there is more room above the trigger than below.
 *   - horizontal: honour the preferred side, flip to the opposite side when
 *     the preferred side overflows AND the opposite side fully fits — so a wide
 *     panel does not trades a right overflow for an off-screen-left one (REEF-134).
 *
 * Pure geometry, so it is unit-testable. An unmeasured panel (width 0 — jsdom,
 * or the frame before first paint) returns the preferred placement unchanged, so
 * nothing flips on a guess.
 */
export function computePanelPlacement({
  trigger,
  panel,
  viewport,
  boundary,
  preferredHorizontal = "start",
  margin = 8,
}: {
  trigger: TriggerRect;
  panel: PanelSize;
  viewport: Viewport;
  boundary?: PlacementBoundary;
  preferredHorizontal?: HorizontalPlacement;
  margin?: number;
}): PanelPlacement {
  // Unmeasured panel: don't flip on a guess.
  if (panel.width <= 0) {
    return { vertical: "down", horizontal: preferredHorizontal };
  }

  const viewportLimits = {
    top: 0,
    bottom: viewport.height,
    left: 0,
    right: viewport.width,
  };
  const limits = boundary
    ? {
        top: Math.max(viewportLimits.top, boundary.top),
        bottom: Math.min(viewportLimits.bottom, boundary.bottom),
        left: Math.max(viewportLimits.left, boundary.left),
        right: Math.min(viewportLimits.right, boundary.right),
      }
    : viewportLimits;

  const spaceBelow = limits.bottom - trigger.bottom;
  const spaceAbove = trigger.top - limits.top;
  const neededHeight = panel.height + margin;
  const vertical: VerticalPlacement =
    spaceBelow < neededHeight && spaceAbove > spaceBelow ? "up" : "down";

  const fitsStart = trigger.left + panel.width <= limits.right - margin;
  const fitsEnd = trigger.right - panel.width >= limits.left + margin;
  let horizontal: HorizontalPlacement = preferredHorizontal;
  if (preferredHorizontal === "start" && !fitsStart && fitsEnd) {
    horizontal = "end";
  } else if (preferredHorizontal === "end" && !fitsEnd && fitsStart) {
    horizontal = "start";
  }

  return { vertical, horizontal };
}
