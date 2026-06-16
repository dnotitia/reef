"use client";

import { cn } from "@/lib/utils";
import { Building2, Server, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_TABS = [
  { href: "/settings/workspace", label: "Workspace", icon: Building2 },
  {
    href: "/settings/preferences",
    label: "Preferences",
    icon: SlidersHorizontal,
  },
  { href: "/settings/deployment", label: "Deployment", icon: Server },
] as const;

/**
 * Top-level Settings navigation (REEF-183). Splits the formerly single scroll
 * column into scope-based tabs — Workspace (team-shared) / Preferences
 * (browser-local) / Deployment (operator-managed) — each its own addressable
 * route so back/forward, open-in-new-tab, deep-link, and bookmark all work.
 *
 * Visually it reuses the issue {@link ViewSwitcher} segmented-control vocabulary
 * (bordered `bg-elevated` track, `bg-surface-hover` active fill) so the two read
 * as one control family. But because each tab is a real page navigation rather
 * than a `?view=` toggle, the semantics are a `<nav>` of `<Link>`s with
 * `aria-current="page"` — not toggle buttons with `aria-pressed`. That also lets
 * Cmd/middle-click open a tab in a new browser tab.
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      data-testid="settings-tabs"
      className="inline-flex items-center gap-0.5 self-start rounded-md border border-border-subtle bg-elevated p-0.5"
    >
      {SETTINGS_TABS.map(({ href, label, icon: Icon }) => {
        // A tab owns its segment, so it stays active on nested routes too
        // (e.g. /settings/workspace/members keeps Workspace active).
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            data-testid={`settings-tab-${label.toLowerCase()}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              isActive
                ? "bg-surface-hover text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
