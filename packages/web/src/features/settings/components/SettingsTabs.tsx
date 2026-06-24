"use client";

import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { cn } from "@/lib/utils";
import { Building2, Server, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_TABS = [
  {
    href: "/settings/workspace",
    id: "workspace",
    labelKey: "tabWorkspace",
    icon: Building2,
  },
  {
    href: "/settings/preferences",
    id: "preferences",
    labelKey: "tabPreferences",
    icon: SlidersHorizontal,
  },
  {
    href: "/settings/deployment",
    id: "deployment",
    labelKey: "tabDeployment",
    icon: Server,
  },
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
  const t = useTranslations("settings.misc");

  return (
    <nav
      aria-label={t("settingsSections")}
      data-testid="settings-tabs"
      className={cn(SEGMENTED_CONTROL_TRACK, "self-start")}
    >
      {SETTINGS_TABS.map(({ href, id, labelKey, icon: Icon }) => {
        // A tab owns its segment, so it stays active on nested routes too
        // (e.g. /settings/workspace/members keeps Workspace active).
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            data-testid={`settings-tab-${id}`}
            className={cn(
              SEGMENTED_CONTROL_ITEM,
              isActive
                ? SEGMENTED_CONTROL_ITEM_ACTIVE
                : SEGMENTED_CONTROL_ITEM_INACTIVE,
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
