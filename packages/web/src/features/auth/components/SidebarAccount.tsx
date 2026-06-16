"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { computeInitials } from "@/components/fields/personIdentity";
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
import { useShortcutsStore } from "@/features/shortcuts/stores/useShortcutsStore";
import { cn } from "@/lib/utils";
import type { AkbMeProfile } from "@reef/core";
import { useMutation } from "@tanstack/react-query";
import { ChevronsUpDown, Keyboard, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { signOutOfWorkspace } from "../signOut.actions";
import { navigateToSignOutTarget } from "../signOutNavigation";

interface SidebarAccountProps {
  appVersion: string;
  collapsed: boolean;
}

/** Display name + email + monogram initials derived from the akb profile. */
export interface AccountIdentity {
  name: string;
  email: string | null;
  /**
   * The row's secondary line under the name: email when present, else the akb
   * username when it carries info the name line doesn't already show. Kept
   * non-null for the common cases so the account row holds the same two-line
   * height as the workspace row above it, keeping the footer rows aligned
   * (REEF-168).
   */
  secondary: string | null;
  initials: string;
  /**
   * The akb login (username), or null when logged out. This is the identity key
   * issue rows store in `assigned_to`, so keying the account avatar by it makes
   * the signed-in user's avatar color and monogram match how they render as an
   * assignee elsewhere (REEF-173).
   */
  login: string | null;
}

/**
 * Resolve a display identity from the (possibly absent) akb profile. Falls
 * back through display_name → username → a neutral "Account" label so the row
 * consistently renders, even when `/auth/me` is 401 or omits the optional fields.
 */
export function deriveIdentity(
  profile: AkbMeProfile | null | undefined,
): AccountIdentity {
  const username = profile?.username?.trim() || null;
  const name = profile?.display_name?.trim() || username || "Account";
  const email = profile?.email?.trim() || null;
  // Prefer email; otherwise show the username when it differs from the name so
  // the row keeps its second line (and therefore its height).
  const secondary = email ?? (username && username !== name ? username : null);
  return {
    name,
    email,
    secondary,
    initials: computeInitials(name),
    login: username,
  };
}

/**
 * The current user's avatar, consistently teal (`tone="brand"`). The same brand tone
 * now marks the signed-in user on every people surface — board cards, list
 * rows, the assignee picker — so the account avatar and the user's own assignee
 * avatar match (REEF-173). Keyed by the akb login (the identifier issue rows
 * store), so its color and monogram line up with how that person renders as an
 * assignee elsewhere; falls back to the display name when logged out (no login).
 */
function AccountAvatar({
  name,
  login,
  large,
}: { name: string; login: string | null; large?: boolean }) {
  return (
    <PersonAvatar
      identityKey={login ?? name}
      name={name}
      tone="brand"
      size={large ? "lg" : "md"}
      decorative
    />
  );
}

/**
 * consistently-visible akb workspace account control, anchored to the sidebar footer
 * (REEF-068). Opens an upward menu with a keyboard-shortcuts launcher and an
 * akb sign-out (which ends the akb session distinct from the GitHub
 * "Disconnect & sign out" in Settings, AC3). Shown regardless of GitHub PAT
 * state (AC1). The app version, which previously sat bare in the footer, now
 * lives at the bottom of this menu.
 */
export function SidebarAccount({ appVersion, collapsed }: SidebarAccountProps) {
  const router = useRouter();
  const { data: profile, isLoading } = useCurrentUser();
  const identity = deriveIdentity(profile);
  // Granular selector — the toggle, so the menu doesn't re-render when the
  // shortcuts dialog opens/closes elsewhere.
  const toggleShortcuts = useShortcutsStore((state) => state.toggle);

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
          aria-label="Account menu"
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

          {/* Keyboard shortcuts launcher — opens the existing ⌘? cheat sheet.
              Pure dialog launcher (not a duplicated setting), so the standard
              DropdownMenuItem that auto-closes the menu on select is exactly
              right here. */}
          <DropdownMenuItem
            onSelect={toggleShortcuts}
            data-testid="account-shortcuts"
            className="justify-between gap-2 py-1.5 [touch-action:manipulation]"
          >
            <span className="flex items-center gap-2">
              <Keyboard
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              Keyboard shortcuts
            </span>
            <span
              aria-hidden="true"
              className="text-[11px] text-muted-foreground"
            >
              ⌘?
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Theme quick switch (REEF-095). High-frequency setting surfaced
              here for fast access; the shared cursor (useThemeStore) keeps it
              in lockstep with Settings → Appearance. The buttons live inside
              the menu so selecting one does not dismiss it (AC4). */}
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <AccountThemeToggle />

          <DropdownMenuSeparator />

          {/* A native <button role="menuitem"> rather than DropdownMenuItem:
              the menu should stay open through the async sign-out so the spinner
              and any error render in place (DropdownMenuItem auto-closes on
              select). `disabled` blocks re-entry and drops it from the tab
              order while the request is in flight. */}
          <button
            type="button"
            role="menuitem"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
            data-testid="account-signout"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors duration-150 [touch-action:manipulation]",
              "hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            {signOut.isPending ? (
              <Spinner className="size-3.5" aria-hidden="true" />
            ) : (
              <LogOut className="size-3.5" aria-hidden="true" />
            )}
            <span>{signOut.isPending ? "Signing out…" : "Sign out"}</span>
          </button>

          <p
            aria-live="polite"
            className="px-2 text-[11px] text-destructive empty:hidden"
          >
            {signOut.isError
              ? "Couldn't sign out. Check your connection and try again."
              : null}
          </p>

          <DropdownMenuSeparator />

          <div
            className="px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground"
            data-testid="account-version"
          >
            <span translate="no">reef</span> v{appVersion}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
