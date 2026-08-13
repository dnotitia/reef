"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip";

/** Marker for the exact text node whose width determines tooltip eligibility. */
export const OVERFLOW_TARGET_SELECTOR = "[data-overflow-target]";

function hasOverflow(
  container: HTMLElement,
  targetSelector?: string,
): boolean | undefined {
  const target = targetSelector
    ? container.querySelector<HTMLElement>(targetSelector)
    : container;
  if (!target) return false;

  // A conditional Radix trigger can replace the wrapper before its new text
  // node has participated in layout. Preserve a known result until that node
  // has measurable geometry; otherwise a transient 0/0 read can undo a real
  // overflow result and make the tooltip flicker out of the same render pass.
  if (target.clientWidth === 0 && target.scrollWidth === 0) {
    return target.textContent?.trim() ? undefined : false;
  }

  return target.scrollWidth > target.clientWidth;
}

/**
 * Measure a rendered text node against its own available width.
 *
 * The observer watches the container and the marked text node so a parent
 * layout change, font load, or text replacement can settle the result without
 * registering one global resize listener per row.
 */
export function useOverflowMeasurement(
  containerRef: RefObject<HTMLElement | null>,
  value: string,
  targetSelector?: string,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  // The trigger wrapper changes shape when the first overflow result enables
  // Radix's TooltipTrigger. Re-run only for this primitive state transition so
  // the observer follows the newly committed DOM node without a per-render
  // layout read.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setIsOverflowing(false);
      return;
    }

    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const next = hasOverflow(container, targetSelector);
      if (next === undefined) return;
      setIsOverflowing((previous) => (previous === next ? previous : next));
    };

    measure();
    const frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(measure)
        : undefined;
    // Portaled panels can settle their final width after the first paint. A
    // second frame catches that layout without adding a global resize listener.
    let settleFrame: number | undefined;
    if (typeof requestAnimationFrame === "function") {
      settleFrame = requestAnimationFrame(() => {
        if (!disposed) settleFrame = requestAnimationFrame(measure);
      });
    }
    const fontsReady = document.fonts?.ready;
    void fontsReady?.then(measure, () => undefined);

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : undefined;
    observer?.observe(container);
    const target = targetSelector
      ? container.querySelector<HTMLElement>(targetSelector)
      : container;
    if (target && target !== container) observer?.observe(target);

    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
      observer?.disconnect();
    };
  }, [containerRef, targetSelector, value, isOverflowing]);

  return isOverflowing;
}

interface OverflowTooltipProps {
  children: ReactNode;
  /** The untruncated value shown by the tooltip and accessible description. */
  text: string;
  /** Keeps the tooltip open while the owning combobox row is keyboard-active. */
  active?: boolean;
  /** Class names for the non-focusable trigger wrapper. */
  className?: string;
  /** Selector for the exact text node to measure inside the wrapper. */
  targetSelector?: string;
  /** Reports the geometry result to the owning focusable control. */
  onOverflowChange?: (isOverflowing: boolean) => void;
}

/**
 * An opt-in Radix tooltip trigger for a measured text value.
 *
 * When the value fits, only the layout wrapper remains: no Radix tooltip root,
 * content, or aria-describedby is created. The wrapper is intentionally not
 * focusable; callers keep ownership of the existing link, input, or button.
 */
export function OverflowTooltip({
  children,
  text,
  active = false,
  className,
  targetSelector = OVERFLOW_TARGET_SELECTOR,
  onOverflowChange,
}: OverflowTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const isOverflowing = useOverflowMeasurement(
    triggerRef,
    text,
    targetSelector,
  );
  const [pointerOpen, setPointerOpen] = useState(false);
  const [activeDismissed, setActiveDismissed] = useState(false);

  useEffect(() => {
    onOverflowChange?.(isOverflowing);
  }, [isOverflowing, onOverflowChange]);

  // A new active row may reuse the same component instance. Reset only when
  // the active identity/value changes so Escape can dismiss the current one.
  useEffect(() => {
    setActiveDismissed(false);
  }, [active, text]);

  const open =
    isOverflowing &&
    text.length > 0 &&
    (pointerOpen || (active && !activeDismissed));

  const trigger = (
    <span ref={triggerRef} className={className}>
      {children}
    </span>
  );

  if (!isOverflowing) return trigger;

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setPointerOpen(true);
          setActiveDismissed(false);
        } else {
          setPointerOpen(false);
          // Pointer leave should not hide a tooltip that remains keyboard-active.
          // Radix reports both pointer leave and Escape through this callback;
          // Escape is handled explicitly by TooltipContent below.
          if (active && !pointerOpen) setActiveDismissed(true);
        }
      }}
    >
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent onEscapeKeyDown={() => setActiveDismissed(true)}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
