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
import { useWorkspaceFavorites } from "@/features/auth/hooks/useWorkspaceFavorites";
import {
  compareWorkspaceNames,
  isValidWorkspaceFavoriteName,
} from "@/lib/storage/workspaceFavorites";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { Check, ChevronsUpDown, Plus, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface SidebarWorkspaceProps {
  collapsed: boolean;
  onPreload?: () => void;
}

/**
 * Workspace identity in the navigation group. The square monogram
 * distinguishes workspace context from the account avatar in the footer.
 */
function WorkspaceMonogram({
  name,
  collapsed,
}: {
  name: string;
  collapsed: boolean;
}) {
  const initials = name.trim() ? computeInitials(name) : "?";
  return (
    <span
      aria-hidden="true"
      data-testid="workspace-monogram"
      className={cn(
        "type-caption inline-flex shrink-0 select-none items-center justify-center rounded-md bg-surface-elevated font-mono font-medium leading-none text-foreground ring-1 ring-border",
        collapsed ? "size-9" : "size-7",
      )}
    >
      {initials}
    </span>
  );
}

/**
 * Workspace-group selector (REEF-146). It answers "which workspace am I in,
 * and how do I switch or add one" without a trip back to full-screen
 * onboarding.
 *
 *  - Expanded: the workspace name centered vertically beside its monogram.
 *  - Collapsed (w-14): the monogram, with the vault name in `title`.
 *  - Click: a downward popover listing the user's active Reef workspaces (with
 *    search), the current one marked with ✓ + a brand rail; picking another
 *    switches the active vault. A pinned "New workspace" entry is consistently
 *    present — even with zero reef vaults — and opens the create dialog.
 */
export function SidebarWorkspace({
  collapsed,
  onPreload,
}: SidebarWorkspaceProps) {
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

  const reefVaults = useMemo(() => {
    const seen = new Set<string>();
    return (vaultsQuery.data ?? [])
      .filter(
        (vault) =>
          vault.installation_active === true &&
          isValidWorkspaceFavoriteName(vault.name),
      )
      .filter((vault) => {
        const foldedName = vault.name.toLowerCase();
        if (seen.has(foldedName)) return false;
        seen.add(foldedName);
        return true;
      })
      .toSorted((left, right) => compareWorkspaceNames(left.name, right.name));
  }, [vaultsQuery.data]);
  const reefVaultNames = useMemo(
    () => reefVaults.map((vault) => vault.name),
    [reefVaults],
  );
  const hasUnknownAvailability =
    vaultsQuery.data?.some((vault) => vault.installation_active === null) ??
    false;
  const workspaceFavorites = useWorkspaceFavorites(reefVaultNames, {
    enabled: !vaultsQuery.isPending && !vaultsQuery.isError,
  });
  const filtered = useMemo(
    () =>
      reefVaults.filter((v) =>
        v.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [reefVaults, search],
  );
  const favoriteNames = useMemo(
    () => new Set(workspaceFavorites.favorites),
    [workspaceFavorites.favorites],
  );
  const favoriteVaults = useMemo(
    () => filtered.filter((vault) => favoriteNames.has(vault.name)),
    [favoriteNames, filtered],
  );
  const otherVaults = useMemo(
    () => filtered.filter((vault) => !favoriteNames.has(vault.name)),
    [favoriteNames, filtered],
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
    // workspace-scoped query and form state. Navigate to the new workspace's
    // board (now a distinct `/workspace/{next}/issues` URL, so the
    // whole subtree remounts) and the URL→Dexie sync records it as the new
    // "last viewed" default (REEF-315 AC6). Query-driven surfaces refetch under
    // the rekeyed vault.
    router.push(withVault(next, "/issues"));
  }

  function handleNewWorkspace() {
    setOpen(false);
    setSearch("");
    onPreload?.();
    openCreateWorkspaceDialog();
  }

  function renderWorkspaceOption(v: (typeof reefVaults)[number]) {
    const isCurrent = v.name === activeVault;
    const isFavorite = favoriteNames.has(v.name);
    const favoriteLabel = isFavorite
      ? tw("removeFavorite", { name: v.name })
      : tw("addFavorite", { name: v.name });

    return (
      <li key={v.name} className="relative">
        {isCurrent && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-brand-fill"
          />
        )}
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            data-testid={`workspace-switcher-option-${v.name}`}
            aria-current={isCurrent ? "true" : undefined}
            onClick={() => void handleSelect(v.name)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left type-navigation transition-colors hover:bg-surface-hover",
              isCurrent
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Check
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-brand-text",
                isCurrent ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0 truncate" title={v.name}>
              {v.name}
            </span>
          </button>
          <button
            type="button"
            data-testid={`workspace-switcher-favorite-${v.name}`}
            aria-label={favoriteLabel}
            aria-pressed={isFavorite}
            title={favoriteLabel}
            onClick={() => void workspaceFavorites.toggleFavorite(v.name)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            <Star
              aria-hidden="true"
              className="size-3.5"
              fill={isFavorite ? "currentColor" : "none"}
            />
          </button>
        </div>
      </li>
    );
  }

  return (
    <div
      className={cn("py-1", collapsed && "-mx-0.5")}
      data-testid="sidebar-workspace"
    >
      <Popover open={open} onOpenChange={setOpen} className="w-full">
        <PopoverTrigger
          data-testid="sidebar-workspace-trigger"
          aria-haspopup="dialog"
          aria-label={
            activeVault
              ? tw("workspaceAria", { name: activeVault })
              : tw("selectWorkspaceAria")
          }
          title={collapsed ? label : undefined}
          className={cn(
            "min-h-11 w-full gap-2 rounded-md text-left [touch-action:manipulation] hover:bg-surface-hover active:bg-surface-hover aria-expanded:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:cursor-not-allowed disabled:opacity-50",
            collapsed ? "justify-center px-0 py-1" : "px-3 py-1.5",
          )}
        >
          {isLoading ? (
            <Skeleton
              className={cn("rounded-md", collapsed ? "size-9" : "size-7")}
            />
          ) : (
            <WorkspaceMonogram name={activeVault} collapsed={collapsed} />
          )}

          {!collapsed && (
            <span className="flex min-w-0 flex-1 items-center">
              {isLoading ? (
                <Skeleton className="h-3.5 w-24" />
              ) : (
                <span className="type-navigation truncate text-foreground">
                  {label}
                </span>
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
          side="bottom"
          align="start"
          role="dialog"
          aria-label={tw("selectWorkspaceAria")}
          data-testid="workspace-switcher"
          className="w-56 p-2"
        >
          <input
            type="text"
            className="mb-2 w-full rounded-md border border-border bg-surface-elevated px-2 py-1 type-control text-foreground outline-none transition-colors focus:border-brand-focus focus:ring-2 focus:ring-brand-focus"
            placeholder={tw("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="workspace-switcher-search"
            aria-label={tw("searchLabel")}
            autoComplete="off"
            spellCheck={false}
          />

          {workspaceFavorites.hasStorageError && (
            <p
              role="alert"
              data-testid="workspace-switcher-favorites-error"
              className="mb-2 px-2 type-card-metadata text-destructive-text"
            >
              {tw("favoritesSaveError")}
            </p>
          )}

          <ul className="max-h-56 overflow-y-auto">
            {vaultsQuery.isError ? (
              <li
                role="alert"
                className="flex flex-col items-start gap-2 px-2 py-1.5 type-control text-destructive-text"
                data-testid="workspace-switcher-error"
              >
                {tw("loadError")}
                <button
                  type="button"
                  data-testid="workspace-switcher-retry"
                  className="text-foreground underline underline-offset-2"
                  onClick={() => void vaultsQuery.refetch()}
                >
                  {tw("retry")}
                </button>
              </li>
            ) : vaultsQuery.isPending ? (
              // Don't claim "no workspaces" before the list has loaded — a cold
              // load / slow vault fan-out would flash a false empty state.
              <li
                className="px-2 py-1.5 type-control text-muted-foreground"
                data-testid="workspace-switcher-loading"
              >
                {tw("loading")}
              </li>
            ) : reefVaults.length === 0 && hasUnknownAvailability ? (
              <li
                role="alert"
                className="flex flex-col items-start gap-2 px-2 py-1.5 type-control text-muted-foreground"
                data-testid="workspace-switcher-availability-unknown"
              >
                {tw("availabilityUnknown")}
                <button
                  type="button"
                  data-testid="workspace-switcher-retry"
                  className="text-foreground underline underline-offset-2"
                  onClick={() => void vaultsQuery.refetch()}
                >
                  {tw("retry")}
                </button>
              </li>
            ) : filtered.length === 0 ? (
              <li
                className="px-2 py-1.5 type-control text-muted-foreground"
                data-testid="workspace-switcher-empty"
              >
                {reefVaults.length === 0
                  ? tw("noReefWorkspaces")
                  : tw("noWorkspacesFound")}
              </li>
            ) : (
              <>
                {favoriteVaults.length > 0 && (
                  <li data-testid="workspace-switcher-favorites">
                    <h3 className="type-card-metadata px-2 pb-1 pt-1 font-semibold text-muted-foreground">
                      {tw("favorites")}
                    </h3>
                    <ul>{favoriteVaults.map(renderWorkspaceOption)}</ul>
                  </li>
                )}
                {otherVaults.length > 0 && (
                  <li data-testid="workspace-switcher-other">
                    <h3 className="type-card-metadata px-2 pb-1 pt-2 font-semibold text-muted-foreground">
                      {tw("otherWorkspaces")}
                    </h3>
                    <ul>{otherVaults.map(renderWorkspaceOption)}</ul>
                  </li>
                )}
              </>
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
            onMouseEnter={onPreload}
            onFocus={onPreload}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 type-control text-foreground transition-colors hover:bg-surface-hover"
          >
            <Plus aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{tw("newWorkspace")}</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
