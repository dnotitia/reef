"use client";

import { useShortcutsStore } from "@/features/shortcuts/stores/useShortcutsStore";
import { cn } from "@/lib/utils";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";

interface SidebarFooterShortcutsProps {
  readonly collapsed: boolean;
}

/**
 * Shell-level utility row for the global keyboard-shortcuts sheet (REEF-170).
 * Kept outside the workspace/account identity block so it reads as app chrome,
 * not as a profile action.
 */
export function SidebarFooterShortcuts({
  collapsed,
}: SidebarFooterShortcutsProps) {
  const toggleShortcuts = useShortcutsStore((state) => state.toggle);
  const t = useTranslations("misc");

  return (
    <div
      className={cn(
        "border-t border-border-subtle/70 px-2 py-1",
        collapsed && "px-1.5",
      )}
      data-testid="sidebar-footer-shortcuts"
    >
      <button
        type="button"
        onClick={toggleShortcuts}
        aria-label={t("keyboardShortcuts")}
        title={t("keyboardShortcutsTitle", { keychord: "⌘?" })}
        data-testid="sidebar-shortcuts-trigger"
        className={cn(
          "inline-flex shrink-0 items-center rounded-md text-muted-foreground/80 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          collapsed
            ? "h-8 w-8 justify-center"
            : "h-7 w-full justify-between gap-2 px-2 text-left text-[12px]",
        )}
      >
        <span className={cn("flex items-center", !collapsed && "gap-2")}>
          <Keyboard
            aria-hidden="true"
            className={cn("shrink-0", collapsed ? "size-4" : "size-3.5")}
          />
          {!collapsed && (
            <span className="truncate">{t("keyboardShortcuts")}</span>
          )}
        </span>
        {!collapsed && (
          <span
            aria-hidden="true"
            className="font-mono text-[10px] text-muted-foreground/60"
          >
            ⌘?
          </span>
        )}
      </button>
    </div>
  );
}
