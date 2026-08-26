"use client";

/**
 * Lightweight non-modal Popover built with native HTML + React state.
 *
 * The primitive owns open state, dismissal reasons, and focus ownership. The
 * caller owns the content meaning: every PopoverContent must declare a role
 * and an accessible name instead of inheriting a forced dialog role.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useOverlayOpenRegistration } from "./overlayDismiss";

type PopoverDismissReason =
  | "trigger"
  | "escape"
  | "outside"
  | "select"
  | "programmatic";

type PopoverInitialFocus =
  | React.RefObject<HTMLElement | null>
  | (() => HTMLElement | null);

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean, reason?: PopoverDismissReason) => void;
  close: (reason?: PopoverDismissReason) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentId: string;
}

const PopoverContext = React.createContext<PopoverContextValue>({
  open: false,
  setOpen: () => undefined,
  close: () => undefined,
  rootRef: { current: null },
  triggerRef: { current: null },
  contentId: "popover-content",
});

interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (
    open: boolean,
    reason: PopoverDismissReason,
  ) => void;
  className?: string;
}

/* ----------------------------- Root ----------------------------- */
function Popover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentId = `popover-${React.useId().replaceAll(":", "")}`;
  const openRef = React.useRef(open);
  const pendingDismissReasonRef = React.useRef<PopoverDismissReason | null>(
    null,
  );
  const previousOpenRef = React.useRef(open);
  const focusOriginRef = React.useRef<HTMLElement | null>(null);
  const focusRestoreScheduledRef = React.useRef(false);

  openRef.current = open;

  const captureFocusOrigin = React.useCallback(() => {
    const trigger = triggerRef.current;
    const active =
      typeof document === "undefined" ? null : document.activeElement;
    if (
      typeof HTMLElement !== "undefined" &&
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
    ) {
      focusOriginRef.current = active;
      return;
    }
    if (trigger) focusOriginRef.current = trigger;
  }, []);

  // A controlled popover may mount already open (the quick-edit portal does
  // this), so capture the pre-panel active element before its content layout
  // effect moves focus into the panel.
  if (open && focusOriginRef.current === null) {
    captureFocusOrigin();
  }

  const restoreTriggerFocus = React.useCallback(() => {
    if (focusRestoreScheduledRef.current) return;
    const origin = focusOriginRef.current;
    const trigger = triggerRef.current;
    const target =
      origin?.isConnected === true
        ? origin
        : trigger?.isConnected
          ? trigger
          : null;
    if (!target) {
      focusOriginRef.current = null;
      return;
    }

    const focus = () => {
      const active =
        typeof document === "undefined" ? null : document.activeElement;
      const focusMovedOutside =
        typeof HTMLElement !== "undefined" &&
        active instanceof HTMLElement &&
        active !== document.body &&
        active !== document.documentElement &&
        !rootRef.current?.contains(active);
      if (focusMovedOutside) {
        focusRestoreScheduledRef.current = false;
        focusOriginRef.current = null;
        return;
      }
      if (target.isConnected) target.focus({ preventScroll: true });
      focusRestoreScheduledRef.current = false;
      focusOriginRef.current = null;
    };
    if (typeof window === "undefined") {
      focus();
      return;
    }
    focusRestoreScheduledRef.current = true;
    window.requestAnimationFrame(focus);
  }, []);

  const setOpen = React.useCallback(
    (next: boolean, reason: PopoverDismissReason = "programmatic") => {
      if (openRef.current === next) return;
      openRef.current = next;
      pendingDismissReasonRef.current = next ? null : reason;
      if (next) captureFocusOrigin();
      else if (reason === "outside") focusOriginRef.current = null;
      else restoreTriggerFocus();
      setInternalOpen(next);
      onOpenChange?.(next, reason);
    },
    [captureFocusOrigin, onOpenChange, restoreTriggerFocus],
  );
  const close = React.useCallback(
    (reason: PopoverDismissReason = "programmatic") => {
      setOpen(false, reason);
    },
    [setOpen],
  );

  // An external controlled close (including selection-complete handlers that
  // own their state) still returns focus to the trigger. Outside dismissal is
  // the one exception: the pointer target owns focus in that case.
  React.useLayoutEffect(() => {
    const previousOpen = previousOpenRef.current;
    if (previousOpen && !open) {
      const reason = pendingDismissReasonRef.current ?? "programmatic";
      pendingDismissReasonRef.current = null;
      const active =
        typeof document !== "undefined" ? document.activeElement : null;
      const activeOutside =
        typeof HTMLElement !== "undefined" &&
        active instanceof HTMLElement &&
        active !== document.body &&
        active !== document.documentElement &&
        !rootRef.current?.contains(active);
      if (reason !== "outside" && !activeOutside) restoreTriggerFocus();
      else focusOriginRef.current = null;
    }
    previousOpenRef.current = open;
  }, [open, restoreTriggerFocus]);

  // While open inside a Sheet/Dialog, defer Escape to this popover so the
  // parent overlay does not consume the event first.
  const dismissForEscape = React.useCallback(() => {
    close("escape");
  }, [close]);
  useOverlayOpenRegistration(open, dismissForEscape);

  return (
    <PopoverContext.Provider
      value={{ open, setOpen, close, rootRef, triggerRef, contentId }}
    >
      <div ref={rootRef} className={cn("relative inline-block", className)}>
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

/* ----------------------------- Trigger ----------------------------- */
type PopoverTriggerProps = React.ComponentPropsWithoutRef<"button">;

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  PopoverTriggerProps
>(function PopoverTrigger(
  {
    children,
    className,
    onClick,
    onKeyDown,
    type,
    ...props
  },
  forwardedRef,
) {
  const { open, setOpen, triggerRef, contentId } =
    React.useContext(PopoverContext);
  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef, triggerRef],
  );

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    setOpen(!open, "trigger");
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, "escape");
  };

  return (
    <button
      ref={setRefs}
      type={type ?? "button"}
      {...props}
      aria-expanded={open}
      aria-controls={contentId}
      className={cn("inline-flex items-center", className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
});
PopoverTrigger.displayName = "PopoverTrigger";

type PopoverContentName =
  | {
      "aria-label": string;
      "aria-labelledby"?: never;
    }
  | {
      "aria-label"?: never;
      "aria-labelledby": string;
    };

type PopoverContentProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "role" | "aria-label" | "aria-labelledby"
> &
  PopoverContentName & {
    role: React.AriaRole;
    align?: "start" | "end" | "center";
    side?: "top" | "bottom";
    sideOffset?: number;
    initialFocus?: PopoverInitialFocus;
  };

function findInitialFocusTarget(
  content: HTMLDivElement,
  initialFocus: PopoverInitialFocus | undefined,
): HTMLElement | null {
  const explicit =
    typeof initialFocus === "function"
      ? initialFocus()
      : initialFocus?.current;
  if (explicit && !explicit.hasAttribute("disabled")) return explicit;
  return content.querySelector<HTMLElement>(
    '[autofocus], [data-popover-initial-focus], input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  );
}

/* ----------------------------- Content ----------------------------- */
const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent(
    {
      children,
      className,
      align = "start",
      side = "bottom",
      sideOffset = 4,
      role,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      initialFocus,
      onKeyDown,
      id,
      tabIndex,
      ...props
    },
    forwardedRef,
  ) {
    const { open, setOpen, rootRef, contentId } =
      React.useContext(PopoverContext);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    if (
      !role ||
      ((!ariaLabel || !ariaLabel.trim()) &&
        (!ariaLabelledBy || !ariaLabelledBy.trim()))
    ) {
      throw new Error(
        "PopoverContent requires an explicit role and accessible name.",
      );
    }

    const alignClass =
      align === "end"
        ? "right-0"
        : align === "center"
          ? "left-1/2 -translate-x-1/2"
          : "left-0";

    React.useLayoutEffect(() => {
      if (!open) return;
      const content = contentRef.current;
      if (!content) return;
      const target = findInitialFocusTarget(content, initialFocus);
      if (!target) return;
      target.focus({ preventScroll: true });
    }, [initialFocus, open]);

    React.useEffect(() => {
      if (!open) return;
      const handlePointerDown = (event: PointerEvent) => {
        const root = rootRef.current;
        if (root && !root.contains(event.target as Node)) {
          setOpen(false, "outside");
        }
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Content/trigger handlers consume events inside the root first. This
        // document fallback covers programmatic focus and other root children.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false, "escape");
      };
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, rootRef, setOpen]);

    const handleContentKeyDown = (
      event: React.KeyboardEvent<HTMLDivElement>,
    ) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, "escape");
    };

    if (!open) return null;
    return (
      <div
        ref={setRefs}
        id={id ?? contentId}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={tabIndex ?? -1}
        className={cn(
          "absolute z-50 min-w-[200px] rounded-md border border-border bg-surface-popover p-1 shadow-lg shadow-foreground/5 outline-none",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
          alignClass,
          sideOffset === 0 ? undefined : side === "top" ? "mb-1" : "mt-1",
          "motion-safe:animate-in motion-safe:fade-in-0",
          className,
        )}
        onKeyDown={handleContentKeyDown}
        {...props}
      >
        {children}
      </div>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

/* ----------------------------- Anchor ----------------------------- */
function PopoverAnchor({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function usePopoverContext(): PopoverContextValue {
  return React.useContext(PopoverContext);
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  usePopoverContext,
};
export type {
  PopoverContextValue,
  PopoverContentProps,
  PopoverDismissReason,
  PopoverInitialFocus,
  PopoverProps,
};
