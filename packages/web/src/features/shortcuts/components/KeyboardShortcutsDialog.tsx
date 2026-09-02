"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import {
  SHORTCUT_GROUPS,
  formatKey,
  getShortcutKeys,
  isMacLike,
} from "../lib/shortcuts";
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
  const t = useTranslations("misc");
  const commands = useTranslations("commands") as unknown as (
    key: string,
  ) => string;

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-testid="keyboard-shortcuts-dialog"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t("keyboardShortcuts")}</DialogTitle>
          <DialogDescription>{t("shortcutsDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.titleKey}>
              <h3 className="type-card-metadata mb-1.5 font-semibold uppercase tracking-wider text-muted-foreground">
                {commands(`groups.${group.titleKey}`)}
              </h3>
              <ul className="flex flex-col gap-1">
                {group.shortcuts.map((sc) => {
                  const sequences = [
                    getShortcutKeys(sc),
                    ...(sc.alternateKeys ?? []),
                  ];
                  return (
                    <li
                      key={sc.id}
                      className="flex items-center justify-between gap-3"
                      data-testid="shortcut-row"
                      data-shortcut-label={sc.id}
                    >
                      <span className="text-foreground/90">
                        {commands(`actions.${sc.labelKey}`)}
                      </span>
                      <span className="flex items-center gap-1">
                        {sequences.map((sequence, sequenceIndex) => (
                          <Fragment key={`${sc.id}:sequence:${sequenceIndex}`}>
                            {sequenceIndex > 0 && (
                              <span
                                aria-hidden="true"
                                className="px-0.5 type-caption text-muted-foreground"
                              >
                                /
                              </span>
                            )}
                            {sequence.map((key, i) => (
                              // Combine the shortcut label with the token + slot
                              // so each row's key sequence is stable even when two
                              // shortcuts share a modifier ("mod" appears in many).
                              <Fragment
                                key={`${sc.id}:${sequenceIndex}:${i}:${key}`}
                              >
                                {i > 0 && (
                                  <span
                                    aria-hidden="true"
                                    className="type-caption text-muted-foreground"
                                  >
                                    +
                                  </span>
                                )}
                                <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border-subtle bg-surface-subtle px-1.5 type-compact-mono font-medium text-foreground shadow-[0_1px_0_0_rgb(0_0_0_/_0.05)]">
                                  {formatKey(key, mac)}
                                </kbd>
                              </Fragment>
                            ))}
                          </Fragment>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
