"use client";

import type { ReactElement, RefObject } from "react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Measure the rendered text node instead of guessing from its content or CSS.
 * ResizeObserver covers both the node's own text/layout changes and its
 * container changing width; the animation frame and font promise cover the
 * first paint and late font metrics.
 */
export function useTextOverflow<T extends HTMLElement>(
  textRef: RefObject<T | null>,
  text: string,
  enabled = true,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsOverflowing(false);
      return;
    }
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const element = textRef.current;
      if (
        !element ||
        (element.clientWidth === 0 && element.scrollWidth === 0)
      ) {
        return;
      }
      const next = element.scrollWidth > element.clientWidth;
      setIsOverflowing((previous) => (previous === next ? previous : next));
    };

    // Clear stale eligibility while the new text node is being committed.
    setIsOverflowing(false);
    measure();

    const frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(measure)
        : null;
    const fontReady =
      typeof document === "undefined" ? undefined : document.fonts?.ready;
    void fontReady?.then(measure, () => undefined);

    const element = textRef.current;
    const observer =
      element && typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : undefined;
    if (observer && element) observer.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, textRef, text]);

  return isOverflowing;
}

interface OverflowTooltipProps {
  /** The complete source text shown in the tooltip. */
  value: string;
  /** Eligibility from the actual rendered text node geometry. */
  isOverflowing: boolean;
  /** Keyboard-active state for controls whose DOM focus stays elsewhere. */
  active?: boolean;
  /** Called when Radix dismisses the tooltip (for controlled active state). */
  onDismiss?: () => void;
  /** Reset pointer/focus state after selection or an explicit close. */
  dismissKey?: number;
  children: ReactElement;
}

/**
 * Opt-in tooltip wrapper for a single meaningful, overflowed value.
 * `children` remains the original interactive element, so this wrapper never
 * creates a standalone tab stop or changes the surrounding hit targets.
 */
export function OverflowTooltip({
  value,
  isOverflowing,
  active = false,
  onDismiss,
  dismissKey,
  children,
}: OverflowTooltipProps) {
  const [pointerInside, setPointerInside] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setPointerInside(false);
    setFocused(false);
  }, [dismissKey]);

  if (!isOverflowing) return children;

  const open = active || pointerInside || focused;

  return (
    <TooltipProvider>
      <Tooltip
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            // Radix opens from pointer movement, which is not guaranteed to
            // emit pointerenter for a composed trigger element.
            setPointerInside(true);
            return;
          }
          setPointerInside(false);
          // Pointer leave is a normal Radix close signal. Preserve keyboard
          // focus/active ownership so moving the pointer away cannot dismiss
          // a tooltip that is still needed for keyboard navigation.
          if (!active && !focused) onDismiss?.();
        }}
      >
        <TooltipTrigger
          asChild
          onPointerEnter={() => setPointerInside(true)}
          onPointerLeave={() => setPointerInside(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setFocused(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setPointerInside(false);
              setFocused(false);
              onDismiss?.();
            }
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>{value}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
