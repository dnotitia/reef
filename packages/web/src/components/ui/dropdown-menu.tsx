"use client";

/**
 * Lightweight dropdown-menu built on native HTML <details>/<summary>.
 * No Radix UI dependency — matches the shadcn/ui API surface needed by FilterBar.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useOverlayOpenRegistration } from "./overlayDismiss";

/* ----------------------------- Root ----------------------------- */
interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}
const DropdownMenuContext = React.createContext<DropdownMenuContextValue>({
  open: false,
  setOpen: () => undefined,
  rootRef: { current: null },
});

function DropdownMenu({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Wraps BOTH trigger and content. Outside-click detection keys off this root
  // (not the content alone) so re-clicking the trigger to close is not mistaken
  // for an outside click — otherwise mousedown closes and the trigger's click
  // immediately re-opens (REEF-073).
  const rootRef = React.useRef<HTMLDivElement>(null);
  // While open inside a Sheet/Dialog, defer Escape to this menu so it closes the
  // menu rather than the surrounding sheet (REEF-288).
  useOverlayOpenRegistration(open);
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, rootRef }}>
      {/* `inline-block` (shrink-to-fit) by default. Callers that need the
          trigger to fill its container — e.g. a full-width sidebar-footer row
          whose trailing control must reach the right edge — pass
          `className="w-full"`, mirroring Popover's root (REEF-168). */}
      <div ref={rootRef} className={cn("relative inline-block", className)}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

/* ----------------------------- Trigger ----------------------------- */
function DropdownMenuTrigger({
  children,
  asChild: _asChild,
  className,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { open, setOpen } = React.useContext(DropdownMenuContext);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      className={cn("inline-flex items-center", className)}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Content ----------------------------- */
function DropdownMenuContent({
  children,
  className,
  align: _align = "start",
  side = "bottom",
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end" | "center";
  /**
   * Which edge of the trigger the menu opens from. Defaults to "bottom"
   * (downward) so existing callers are unaffected; "top" opens upward, which
   * a trigger pinned to the bottom of the viewport (e.g. a sidebar footer
   * account menu) needs so the menu doesn't render off-screen.
   */
  side?: "top" | "bottom";
}) {
  const { open, setOpen, rootRef } = React.useContext(DropdownMenuContext);

  React.useEffect(() => {
    if (!open) return;
    // Close on a click outside the whole menu (trigger + content). Keying off the
    // root — not the content — keeps a trigger re-click from counting as outside,
    // so the trigger's own toggle closes it instead of mousedown closing and click
    // re-opening (REEF-073). A click on a checkbox option stays inside, so
    // multi-select facets keep the menu open as before.
    const handleClick = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // …and on Escape, so the menu is dismissible from the keyboard.
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
      role="menu"
      className={cn(
        "absolute left-0 z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg shadow-foreground/5",
        side === "top" ? "bottom-full mb-1" : "top-full mt-1",
        "motion-safe:animate-in motion-safe:fade-in-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ----------------------------- Item ----------------------------- */
function DropdownMenuItem({
  children,
  className,
  onSelect,
  ...props
}: React.ComponentProps<"div"> & { onSelect?: () => void }) {
  const { setOpen } = React.useContext(DropdownMenuContext);
  return (
    <div
      role="menuitem"
      tabIndex={0}
      className={cn(
        "flex cursor-pointer select-none items-center rounded-sm px-2 py-1 text-[13px] text-foreground outline-none transition-colors duration-150",
        "hover:bg-surface-hover focus-visible:bg-surface-hover",
        className,
      )}
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect?.();
          setOpen(false);
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/* ----------------------------- Separator ----------------------------- */
function DropdownMenuSeparator({ className }: { className?: string }) {
  return (
    <div className={cn("-mx-1 my-1 h-px bg-border-subtle", className)} />
  );
}

/* ----------------------------- Label ----------------------------- */
function DropdownMenuLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
