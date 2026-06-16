"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Fragment } from "react";
import { SHORTCUT_GROUPS, formatKey, isMacLike } from "../lib/shortcuts";
import { useShortcutsStore } from "../stores/useShortcutsStore";

/**
 * Cheat-sheet dialog listing every global keyboard shortcut.
 *
 * Mounted once at the shell. Open state lives in `useShortcutsStore` so the
 * ⌘? binding (DashboardShell) and any future help-menu trigger share one
 * canonical source. Platform check (`⌘` vs `Ctrl`) is evaluated at render
 * time inside the dialog, so it stays SSR-safe — the dialog does not renders
 * content until the user opens it on the client.
 */
export function KeyboardShortcutsDialog() {
  const isOpen = useShortcutsStore((s) => s.isOpen);
  const close = useShortcutsStore((s) => s.close);
  const mac = isMacLike();

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-testid="keyboard-shortcuts-dialog"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Speed up everyday actions with these shortcuts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1">
                {group.shortcuts.map((sc) => (
                  <li
                    key={sc.label}
                    className="flex items-center justify-between gap-3"
                    data-testid="shortcut-row"
                    data-shortcut-label={sc.label}
                  >
                    <span className="text-foreground/90">{sc.label}</span>
                    <span className="flex items-center gap-1">
                      {sc.keys.map((key, i) => (
                        // Combine the shortcut label with the token + slot
                        // so each row's key sequence is stable even when two
                        // shortcuts share a modifier ("mod" appears in many).
                        <Fragment key={`${sc.label}:${i}:${key}`}>
                          {i > 0 && (
                            <span
                              aria-hidden="true"
                              className="text-[10px] text-muted-foreground"
                            >
                              +
                            </span>
                          )}
                          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border-subtle bg-surface-subtle px-1.5 font-mono text-[11px] font-medium text-foreground tabular-nums shadow-[0_1px_0_0_rgb(0_0_0_/_0.05)]">
                            {formatKey(key, mac)}
                          </kbd>
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
