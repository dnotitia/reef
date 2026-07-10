"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const WORKSPACE_SUB_TABS = [
  { href: "/settings/workspace", id: "general", labelKey: "subtabGeneral" },
  {
    href: "/settings/workspace/agent-execution",
    id: "agent-execution",
    labelKey: "subtabAgentExecution",
  },
  {
    href: "/settings/workspace/members",
    id: "members",
    labelKey: "subtabMembers",
  },
] as const;

/**
 * Second-tier navigation inside the Workspace settings tab (REEF-183): General
 * (the shared workspace settings) and Members (membership, filled by REEF-179).
 *
 * Both sub-views are scoped by the single Active Workspace selector mounted
 * above them in the workspace layout, so switching workspace updates General
 * and Members together. This tier is rendered as lighter underline tabs — not
 * the bordered segmented track of {@link SettingsTabs} — so the two-level
 * hierarchy reads at a glance instead of looking like one flat row of controls.
 */
export function WorkspaceSubNav() {
  const pathname = usePathname();
  const { vault } = useActiveVault();
  const t = useTranslations("settings.misc");

  return (
    <nav
      aria-label={t("workspaceSections")}
      data-testid="workspace-subnav"
      className="flex items-center gap-4 border-b border-border-subtle"
    >
      {WORKSPACE_SUB_TABS.map(({ href, id, labelKey }) => {
        // Targets are vault-scoped (REEF-315). General is the index route, so it
        // matches exactly; Members owns its own nested segment. Without the
        // exact check, General would also light up on .../workspace/members.
        const fullHref = withVault(vault, href);
        const isActive =
          href === "/settings/workspace"
            ? pathname === fullHref
            : pathname === fullHref || pathname.startsWith(`${fullHref}/`);
        return (
          <Link
            key={href}
            href={fullHref}
            aria-current={isActive ? "page" : undefined}
            data-testid={`workspace-subnav-${id}`}
            className={cn(
              "-mb-px border-b-2 px-0.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              isActive
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
