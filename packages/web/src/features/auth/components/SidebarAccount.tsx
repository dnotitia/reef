"use client";

import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";

export { deriveIdentity } from "./SidebarAccountIdentity";
export { releaseNotesUrl } from "./AccountMenu";

interface SidebarAccountProps {
  appVersion: string;
  collapsed: boolean;
}

/**
 * Sidebar placement adapter for the shared authenticated account interaction.
 * The footer border and padding stay owned by the dashboard shell surface.
 */
export function SidebarAccount({ appVersion, collapsed }: SidebarAccountProps) {
  return (
    <div
      className={cn("border-t border-border-subtle p-2", collapsed && "px-1.5")}
      data-testid="sidebar-account"
    >
      <AccountMenu
        appVersion={appVersion}
        collapsed={collapsed}
        placement="sidebar"
      />
    </div>
  );
}
