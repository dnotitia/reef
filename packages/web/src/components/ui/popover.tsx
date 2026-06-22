"use client";

/**
 * Lightweight Popover built with native HTML + React state.
 * No Radix UI dependency — matches the shadcn/ui Popover API surface.
 * Pattern follows dropdown-menu.tsx (plain HTML context approach).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useOverlayOpenRegistration } from "./overlayDismiss";

/* ----------------------------- Context ----------------------------- */
interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}
const PopoverContext = React.createContext<PopoverContextValue>({
  open: false,
  setOpen: () => undefined,
  rootRef: { current: null },
});

/* ----------------------------- Root ----------------------------- */
function Popover({
  children,
  open: controlledOpen,
  onOpenChange,
  className,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (value: boolean) => {
      setInternalOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  // While open inside a Sheet/Dialog, defer Escape to this popover so it closes
  // the panel rather than the surrounding sheet (REEF-288).
  useOverlayOpenRegistration(open);
  // Wraps BOTH trigger and content. Outside-click detection keys off this root
  // (not the content alone) so re-clicking the trigger to close is not mistaken
  // for an outside click — otherwise mousedown closes and the trigger's click
  // immediately re-opens (REEF-073, same class as the dropdown-menu fix).
  const rootRef = React.useRef<HTMLDivElement>(null);

  return (
    <PopoverContext.Provider value={{ open, setOpen, rootRef }}>
      <div ref={rootRef} className={cn("relative inline-block", className)}>
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

/* ----------------------------- Trigger ----------------------------- */
function PopoverTrigger({
  children,
  asChild: _asChild,
  className,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { open, setOpen } = React.useContext(PopoverContext);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn("inline-flex items-center", className)}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Content ----------------------------- */
function PopoverContent({
  children,
  className,
  align = "start",
  side = "bottom",
  sideOffset: _sideOffset = 4,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end" | "center";
  /**
   * Which edge of the trigger the popover opens from. Defaults to "bottom"
   * (downward) so existing callers are unaffected; "top" opens upward, which a
   * trigger pinned to the bottom of the viewport (e.g. the sidebar-footer
   * workspace switcher) needs so the popover doesn't render off-screen. Mirrors
   * the dropdown-menu primitive's `side` contract.
   */
  side?: "top" | "bottom";
  sideOffset?: number;
}) {
  const { open, setOpen, rootRef } = React.useContext(PopoverContext);

  // Horizontal anchoring relative to the trigger. `end` opens leftward so a
  // right-aligned trigger (e.g. a dialog header action) stays inside the
  // dialog instead of overflowing its clipped edge.
  const alignClass =
    align === "end"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0";

  // Close on a click outside the whole popover (trigger + content). Keying off
  // the root — not the content — keeps a trigger re-click from counting as an
  // outside click, so the trigger's own toggle closes it instead of mousedown
  // closing and the click re-opening (REEF-073).
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // …and on Escape, so the popover is dismissible from the keyboard —
    // mirroring the dropdown-menu primitive, which a sibling footer trigger
    // already honored while this one did not (REEF-171).
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, setOpen, rootRef]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      className={cn(
        "absolute z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg shadow-foreground/5 outline-none",
        side === "top" ? "bottom-full mb-1" : "top-full mt-1",
        alignClass,
        "motion-safe:animate-in motion-safe:fade-in-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ----------------------------- Anchor ----------------------------- */
function PopoverAnchor({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
