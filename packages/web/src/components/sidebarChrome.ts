import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  CircleUser,
  ListTodo,
  Milestone,
  Settings,
} from "lucide-react";

export const SIDEBAR_ASIDE_CLASS =
  "flex shrink-0 flex-col border-r border-border-subtle bg-surface-sidebar";

export const SIDEBAR_BRAND_HEADER_CLASS =
  "flex h-12 items-center border-b border-border-subtle";

export const SIDEBAR_TOGGLE_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus";

export const SIDEBAR_NAV_LINK_CLASS =
  "flex items-center justify-start gap-2 rounded-md px-3 py-1.5 type-navigation transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus";

export const SIDEBAR_NAV_ACTIVE_CLASS =
  "bg-surface-hover text-foreground font-medium";

export const SIDEBAR_NAV_INACTIVE_CLASS =
  "text-muted-foreground hover:bg-surface-hover hover:text-foreground";

export const SIDEBAR_NAV_COLLAPSED_CLASS = "h-9 justify-center px-0";

export const SIDEBAR_NAV_ITEMS: ReadonlyArray<{
  href: string;
  labelKey: "issues" | "myWork" | "inbox" | "planning" | "reports" | "settings";
  testId: string;
  icon: LucideIcon;
}> = [
  { href: "/issues", labelKey: "issues", testId: "issues", icon: ListTodo },
  { href: "/my-work", labelKey: "myWork", testId: "my work", icon: CircleUser },
  { href: "/inbox", labelKey: "inbox", testId: "inbox", icon: Bell },
  {
    href: "/planning",
    labelKey: "planning",
    testId: "planning",
    icon: Milestone,
  },
  { href: "/reports", labelKey: "reports", testId: "reports", icon: BarChart3 },
  {
    href: "/settings",
    labelKey: "settings",
    testId: "settings",
    icon: Settings,
  },
] as const;
