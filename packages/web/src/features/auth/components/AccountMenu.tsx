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

export type AccountMenuPlacement = "sidebar" | "utility";

interface AccountMenuProps {
  appVersion: string;
  collapsed?: boolean;
  placement?: AccountMenuPlacement;
}

export function releaseNotesUrl(appVersion: string): string {
  return `https://github.com/dnotitia/reef/releases/tag/${encodeURIComponent(releaseVersionLabel(appVersion))}`;
}

function releaseVersionLabel(appVersion: string): string {
  return appVersion.startsWith("v") ? appVersion : `v${appVersion}`;
}

/**
 * Shared authenticated account interaction. Consumers own the placement
 * adapter; identity, menu copy, sign-out mutation, and feedback stay here.
 */
export function AccountMenu({
  appVersion,
  collapsed = false,
  placement = "utility",
}: AccountMenuProps) {
  const router = useRouter();
  const t = useTranslations("auth.account");
  const { data: profile, isLoading } = useCurrentUser();
  const identity = deriveIdentity(profile);
  const releaseVersion = releaseVersionLabel(appVersion);
  const inSidebar = placement === "sidebar";

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
    <DropdownMenu className={inSidebar ? "w-full" : undefined}>
      <DropdownMenuTrigger
        aria-label={t("menuLabel")}
        title={inSidebar && collapsed ? identity.name : undefined}
        className={cn(
          "min-h-11 gap-2 rounded-md text-left [touch-action:manipulation] transition-colors hover:bg-surface-hover aria-expanded:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40",
          inSidebar
            ? cn(
                "w-full",
                collapsed ? "justify-center px-0 py-1" : "px-2 py-1.5",
              )
            : "min-h-11 min-w-11 justify-end px-2 py-1.5",
        )}
      >
        {isLoading ? (
          <Skeleton
            className={cn(
              "rounded-md",
              inSidebar ? (collapsed ? "size-9" : "size-7") : "size-8",
            )}
          />
        ) : (
          <AccountAvatar
            name={identity.name}
            login={identity.login}
            large={inSidebar && collapsed}
          />
        )}

        {inSidebar ? (
          !collapsed && (
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
          )
        ) : (
          <span className="hidden min-w-0 max-w-40 flex-col text-right sm:flex">
            <span className="truncate text-[13px] leading-tight text-foreground">
              {identity.name}
            </span>
            {identity.secondary && (
              <span className="truncate text-[11px] leading-tight text-muted-foreground">
                {identity.secondary}
              </span>
            )}
          </span>
        )}

        {(!inSidebar || !collapsed) && (
          <ChevronsUpDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={inSidebar ? "top" : "bottom"}
        align={inSidebar ? "start" : "end"}
        className="w-56"
      >
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

        <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
        <AccountThemeToggle />

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="min-h-11"
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
          className="px-2 text-[11px] text-destructive-text empty:hidden"
        >
          {signOut.isError ? t("signOutError") : null}
        </p>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="min-h-11">
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
  );
}
