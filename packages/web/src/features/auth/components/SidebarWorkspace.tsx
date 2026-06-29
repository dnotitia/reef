"use client";

import { computeInitials } from "@/components/fields/personIdentity";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useActiveVault,
  useSetActiveVault,
} from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { useViewStore } from "@/features/ui/stores/useViewStore";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface SidebarWorkspaceProps {
  collapsed: boolean;
}

/**
 * Workspace identity monogram — a square `bg-elevated` tile with a font-mono
 * initial. Deliberately *not* a PersonAvatar: a square neutral tile reads as a
 * place, the round tinted avatar as a person, so the workspace row and the
 * account row below it stay distinct ("place vs person", REEF-146 / REEF-093).
 */
function WorkspaceMonogram({
  name,
  large,
}: {
  name: string;
  large?: boolean;
}) {
  const initials = name.trim() ? computeInitials(name) : "?";
  return (
    <span
      aria-hidden="true"
      data-testid="workspace-monogram"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md bg-elevated font-mono font-medium leading-none text-foreground ring-1 ring-border",
        large ? "size-9 text-[12px]" : "size-7 text-[11px]",
      )}
    >
      {initials}
    </span>
  );
}

/**
 * Sidebar-footer workspace row + switcher (REEF-146). Sits directly above the
 * account (person) row and answers "which workspace am I in, and how do I
 * switch or add one" without a trip back to full-screen onboarding.
 *
 *  - Expanded: the workspace monogram + the active vault name. (No left brand
 *    rail — the active-page rail is a nav signal; the footer identity rows
 *    stay symmetric with the account row below, REEF-168.)
 *  - Collapsed (w-14): the monogram just, with the vault name in `title`.
 *  - Click: an upward popover listing the user's reef-config vaults (with
 *    search), the current one marked with ✓ + a brand rail; picking another
 *    switches the active vault. A pinned "New workspace" entry is consistently
 *    present — even with zero reef vaults — and opens the create dialog.
 */
export function SidebarWorkspace({ collapsed }: SidebarWorkspaceProps) {
  const { vault: activeVault, isLoading } = useActiveVault();
  const vaultsQuery = useVaults();
  const setActiveVault = useSetActiveVault();
  const openCreateWorkspaceDialog = useViewStore(
    (s) => s.openCreateWorkspaceDialog,
  );
  const router = useRouter();
  const t = useTranslations("workspace");
  const tw = useTranslations("auth.switcher");

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const reefVaults = useMemo(
    () => (vaultsQuery.data ?? []).filter((v) => v.has_reef_config),
    [vaultsQuery.data],
  );
  const filtered = useMemo(
    () =>
      reefVaults.filter((v) =>
        v.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [reefVaults, search],
  );

  const label = activeVault || tw("selectWorkspace");

  async function handleSelect(next: string) {
    setOpen(false);
    setSearch("");
    if (next === activeVault) return;
    // Await the active-vault write before routing: useActiveVault is an
    // infinite-stale query backed by an async Dexie write, so navigating first
    // could mount the destination under the *previous* vault and fetch the old
    // workspace. Awaiting means onSuccess (which updates the active-vault cache)
    // has run by the time we route. If the write fails, surface it and stay put
    // rather than navigating into an inconsistent state.
    try {
      await setActiveVault.mutateAsync(next);
    } catch {
      toast.error(t("switchError"));
      return;
    }
    // Switching is reachable from any route, so it can fire while a page holds
    // vault-scoped local React state that survives an in-place vault change —
    // e.g. the issue-detail form (re-syncs on issue id, not vault) or the
    // activity feed (removed/dismissed/edit state keyed by deterministic ids
    // that collide across workspaces on the same repo). Navigate to the new
    // workspace's board (now a distinct `/workspace/{next}/issues` URL, so the
    // whole subtree remounts) and the URL→Dexie sync records it as the new
    // "last viewed" default (REEF-315 AC6). Query-driven surfaces refetch under
    // the rekeyed vault.
    router.push(withVault(next, "/issues"));
  }

  function handleNewWorkspace() {
    setOpen(false);
    setSearch("");
    openCreateWorkspaceDialog();
  }

  return (
    <div
      className={cn("border-t border-border-subtle p-2", collapsed && "px-1.5")}
      data-testid="sidebar-workspace"
    >
      <Popover open={open} onOpenChange={setOpen} className="w-full">
        <PopoverTrigger
          data-testid="sidebar-workspace-trigger"
          aria-label={
            activeVault
              ? tw("workspaceAria", { name: activeVault })
              : tw("selectWorkspaceAria")
          }
          title={collapsed ? label : undefined}
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
            <WorkspaceMonogram name={activeVault} large={collapsed} />
          )}

          {!collapsed && (
            <span className="flex min-w-0 flex-1 flex-col">
              {isLoading ? (
                <Skeleton className="h-3.5 w-24" />
              ) : (
                <>
                  <span className="truncate text-[13px] leading-tight text-foreground">
                    {label}
                  </span>
                  <span className="truncate text-[11px] leading-tight text-muted-foreground">
                    {tw("workspace")}
                  </span>
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
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          data-testid="workspace-switcher"
          className="w-56 p-2"
        >
          <input
            type="text"
            className="mb-2 w-full rounded-md border border-border bg-elevated px-2 py-1 text-[13px] text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            placeholder={tw("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="workspace-switcher-search"
            aria-label={tw("searchLabel")}
            autoComplete="off"
            spellCheck={false}
          />

          <ul className="max-h-56 overflow-y-auto">
            {vaultsQuery.isError ? (
              <li
                role="alert"
                className="px-2 py-1.5 text-[13px] text-destructive"
                data-testid="workspace-switcher-error"
              >
                {tw("loadError")}
              </li>
            ) : vaultsQuery.isPending ? (
              // Don't claim "no workspaces" before the list has loaded — a cold
              // load / slow vault fan-out would flash a false empty state.
              <li
                className="px-2 py-1.5 text-[13px] text-muted-foreground"
                data-testid="workspace-switcher-loading"
              >
                {tw("loading")}
              </li>
            ) : filtered.length === 0 ? (
              <li
                className="px-2 py-1.5 text-[13px] text-muted-foreground"
                data-testid="workspace-switcher-empty"
              >
                {reefVaults.length === 0
                  ? tw("noReefWorkspaces")
                  : tw("noWorkspacesFound")}
              </li>
            ) : (
              filtered.map((v) => {
                const isCurrent = v.name === activeVault;
                return (
                  <li key={v.name} className="relative">
                    {isCurrent && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-brand"
                      />
                    )}
                    <button
                      type="button"
                      data-testid={`workspace-switcher-option-${v.name}`}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => void handleSelect(v.name)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-hover",
                        isCurrent
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Check
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 text-brand",
                          isCurrent ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{v.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {/* consistently-pinned create entry — present even with zero reef vaults so
              the switcher doubles as the empty-state path into onboarding. */}
          <div
            aria-hidden="true"
            className="-mx-1 my-1 h-px bg-border-subtle"
          />
          <button
            type="button"
            data-testid="workspace-switcher-new"
            onClick={handleNewWorkspace}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-foreground transition-colors hover:bg-surface-hover"
          >
            <Plus aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{tw("newWorkspace")}</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
