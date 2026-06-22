"use client";

/**
 * Overlay-dismiss registry (REEF-288).
 *
 * reef's custom overlays — the shared `Combobox` / `MultiSelectCombobox`, the
 * native `Popover` / `DropdownMenu`, and `IssueRelationInput` — are deliberately
 * NOT Radix layers, so they never enter Radix's `DismissableLayer` stack. Radix
 * listens for Escape on `document` in the *capture* phase and dismisses only its
 * highest layer; with no custom overlay in that stack, the highest layer is
 * always the surrounding Sheet/Dialog. So pressing Escape while a custom overlay
 * was open closed the whole sheet instead of just the overlay — and the overlays'
 * own bubble-phase `stopPropagation()` runs far too late to stop a capture-phase
 * `document` listener.
 *
 * This registry bridges the gap without turning the overlays into Radix layers:
 * each open custom overlay registers with the nearest provider (mounted by
 * `SheetContent` / `DialogContent`), and the surrounding Sheet/Dialog consults it
 * in `onEscapeKeyDown` — when a child overlay is open it `preventDefault()`s so
 * Radix skips its dismiss, leaving the overlay's own Escape handler to close just
 * the overlay. Outside any dialog the context is a no-op default, so overlays on
 * plain pages (the issues-toolbar `SortControl`, sidebar menus) keep their
 * existing standalone Escape behavior untouched.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

export interface OverlayDismissRegistry {
  /** Mark an overlay open; returns a release to call when it closes. */
  acquire: () => () => void;
  /** True while at least one registered overlay is open. */
  hasOpenOverlay: () => boolean;
}

const NOOP_REGISTRY: OverlayDismissRegistry = {
  acquire: () => () => {},
  hasOpenOverlay: () => false,
};

const OverlayDismissContext =
  createContext<OverlayDismissRegistry>(NOOP_REGISTRY);

/**
 * Create a registry instance. `SheetContent` / `DialogContent` create one,
 * consult it in their Escape handler, and provide it to their subtree. The count
 * lives in a ref so the (capture-phase) Escape handler can read it synchronously
 * without depending on a re-render having flushed.
 */
export function useOverlayDismissRegistry(): OverlayDismissRegistry {
  const countRef = useRef(0);
  return useMemo<OverlayDismissRegistry>(
    () => ({
      acquire() {
        countRef.current += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          countRef.current -= 1;
        };
      },
      hasOpenOverlay: () => countRef.current > 0,
    }),
    [],
  );
}

export function OverlayDismissProvider({
  registry,
  children,
}: {
  registry: OverlayDismissRegistry;
  children: ReactNode;
}) {
  return (
    <OverlayDismissContext.Provider value={registry}>
      {children}
    </OverlayDismissContext.Provider>
  );
}

/**
 * Register a custom overlay as open for as long as `open` is true, so the
 * surrounding Sheet/Dialog's Escape handler defers to it. No-ops outside any
 * dialog (the default context). Call once alongside the overlay's `open` state.
 */
export function useOverlayOpenRegistration(open: boolean): void {
  const registry = useContext(OverlayDismissContext);
  useEffect(() => {
    if (!open) return;
    return registry.acquire();
  }, [open, registry]);
}

/**
 * Compose an `onEscapeKeyDown` for a Radix Sheet/Dialog: while a child custom
 * overlay is open, swallow Escape (`preventDefault` → Radix skips its dismiss, so
 * the sheet/dialog stays and the overlay closes itself); otherwise run the
 * caller's handler (or, when there is none, let Radix dismiss as before).
 */
export function useGuardedEscapeKeyDown(
  registry: OverlayDismissRegistry,
  onEscapeKeyDown?: (event: KeyboardEvent) => void,
): (event: KeyboardEvent) => void {
  return useCallback(
    (event: KeyboardEvent) => {
      if (registry.hasOpenOverlay()) {
        event.preventDefault();
        return;
      }
      onEscapeKeyDown?.(event);
    },
    [registry, onEscapeKeyDown],
  );
}
