"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AccountThemeToggle } from "@/features/preferences/components/AccountThemeToggle";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { ChevronsUpDown, ExternalLink, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { signOutOfWorkspace } from "../signOut.actions";
import { navigateToSignOutTarget } from "../signOutNavigation";
import { AccountAvatar, deriveIdentity } from "./SidebarAccountIdentity";

export type { AccountIdentity } from "./SidebarAccountIdentity";
export { deriveIdentity };

interface SidebarAccountProps {
  appVersion: string;
  collapsed: boolean;
}

export function releaseNotesUrl(appVersion: string): string {
  return `https://github.com/dnotitia/reef/releases/tag/${encodeURIComponent(releaseVersionLabel(appVersion))}`;
}

function releaseVersionLabel(appVersion: string): string {
  return appVersion.startsWith("v") ? appVersion : `v${appVersion}`;
}

/**
 * consistently-visible akb workspace account control, anchored to the sidebar footer
 * (REEF-068). Opens an upward menu with the akb sign-out and release-notes
 * context. The global shortcuts launcher is owned by the shell footer utility
 * row, so this component stays scoped to the person/account identity
 * (REEF-170).
 */
export function SidebarAccount({ appVersion, collapsed }: SidebarAccountProps) {
  const router = useRouter();
  const t = useTranslations("auth.account");
  const { data: profile, isLoading } = useCurrentUser();
  const identity = deriveIdentity(profile);
  const releaseVersion = releaseVersionLabel(appVersion);

  const signOut = useMutation({
    mutationFn: signOutOfWorkspace,
    onSuccess: (result) => {
      if (result.redirectUrl) {
        navigateToSignOutTarget(result.redirectUrl);
        return;
      }
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <div
      className={cn("border-t border-border-subtle p-2", collapsed && "px-1.5")}
      data-testid="sidebar-account"
    >
      {/* w-full so the trigger fills the footer row and its trailing chevron
            reaches the right edge — aligned with the workspace row above, whose
            Popover root is already w-full (REEF-168). */}
      <DropdownMenu className="w-full">
        <DropdownMenuTrigger
          aria-label={t("menuLabel")}
          title={collapsed ? identity.name : undefined}
          className={cn(
            "w-full gap-2 rounded-md text-left [touch-action:manipulation] transition-colors hover:bg-surface-hover aria-expanded:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            collapsed ? "justify-center px-0 py-1" : "px-2 py-1.5",
          )}
        >
          {isLoading ? (
            <Skeleton
              className={cn("rounded-md", collapsed ? "size-9" : "size-7")}
            />
          ) : (
            <AccountAvatar
              name={identity.name}
              login={identity.login}
              large={collapsed}
            />
          )}

          {!collapsed && (
            <span className="flex min-w-0 flex-1 flex-col">
              {isLoading ? (
                <Skeleton className="h-3.5 w-24" />
              ) : (
                <>
                  <span className="truncate text-[13px] leading-tight text-foreground">
                    {identity.name}
                  </span>
                  {identity.secondary && (
                    <span className="truncate text-[11px] leading-tight text-muted-foreground">
                      {identity.secondary}
                    </span>
                  )}
                </>
              )}
            </span>
          )}

          {!collapsed && (
            <ChevronsUpDown
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" className="w-56">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <AccountAvatar name={identity.name} login={identity.login} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-foreground">
                {identity.name}
              </span>
              {identity.email && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {identity.email}
                </span>
              )}
            </span>
          </div>

          <DropdownMenuSeparator />

          {/* Theme quick switch (REEF-095). High-frequency setting surfaced
              here for fast access; the shared cursor (useThemeStore) keeps it
              in lockstep with Settings → Appearance. The buttons live inside
              the menu so selecting one does not dismiss it (AC4). */}
          <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
          <AccountThemeToggle />

          <DropdownMenuSeparator />

          {/* Keep the shared menu layer open through the async sign-out so the
              spinner and any error render in place. */}
          <DropdownMenuItem
            disabled={signOut.isPending}
            keepOpen
            leading={
              signOut.isPending ? (
                <Spinner className="size-3.5" aria-hidden="true" />
              ) : (
                <LogOut className="size-3.5" aria-hidden="true" />
              )
            }
            onSelect={() => signOut.mutate()}
            data-testid="account-signout"
          >
            {signOut.isPending ? t("signingOut") : t("signOut")}
          </DropdownMenuItem>

          <p
            aria-live="polite"
            className="px-2 text-[11px] text-destructive empty:hidden"
          >
            {signOut.isError ? t("signOutError") : null}
          </p>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <a
              href={releaseNotesUrl(appVersion)}
              target="_blank"
              rel="noreferrer"
              data-testid="account-release-notes"
              className="justify-between gap-3"
            >
              <span>{t("whatsNew")}</span>
              <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                <span data-testid="account-version">{releaseVersion}</span>
                <ExternalLink aria-hidden="true" className="size-3" />
              </span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
