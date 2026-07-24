"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  useDeleteSavedIssueView,
  useUpdateSavedIssueView,
} from "@/features/issues/hooks/mutations/useSavedIssueViewMutations";
import type { SavedIssueViewPreferences } from "@/features/issues/hooks/useSavedIssueViewPreferences";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import type { SavedIssueView, SavedIssueViewPayload } from "@reef/core";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface SavedViewActionsProps {
  vault: string;
  view: SavedIssueView;
  preferences: SavedIssueViewPreferences;
  setDefault: (id: string | undefined) => Promise<unknown>;
  setFavorite: (id: string, favorite: boolean) => Promise<unknown>;
  updatePayload?: SavedIssueViewPayload;
  triggerClassName?: string;
  triggerContent?: React.ReactNode;
  triggerLabel?: string;
}

export const SAVED_VIEW_ACTION_WIDTH = "w-56";

export function SavedViewActions({
  vault,
  view,
  preferences,
  setDefault,
  setFavorite,
  updatePayload,
  triggerClassName,
  triggerContent,
  triggerLabel,
}: SavedViewActionsProps) {
  const update = useUpdateSavedIssueView(vault);
  const remove = useDeleteSavedIssueView(vault);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(view.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");
  const isDefault = preferences.defaultId === view.id;
  const isFavorite = preferences.favoriteIds.includes(view.id);

  const report = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("error"));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-8 items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            triggerContent ? SAVED_VIEW_ACTION_WIDTH : "w-8 justify-center",
            triggerClassName,
          )}
          aria-label={triggerLabel ?? t("actions", { name: view.name })}
        >
          {triggerContent ?? (
            <MoreHorizontal className="size-4" aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn("right-0 left-auto", SAVED_VIEW_ACTION_WIDTH)}
        >
          {updatePayload ? (
            <DropdownMenuItem
              onSelect={() => {
                update.reset();
                void update
                  .mutateAsync({
                    id: view.id,
                    patch: { payload: updatePayload },
                  })
                  .then(() => toast.success(t("updated")))
                  .catch(report);
              }}
            >
              {t("updateCurrent")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              update.reset();
              setRenameValue(view.name);
              setRenameOpen(true);
            }}
          >
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void setFavorite(view.id, !isFavorite)
                .then(() =>
                  toast.success(
                    isFavorite ? t("favoriteRemoved") : t("favoriteAdded"),
                  ),
                )
                .catch(report);
            }}
          >
            {isFavorite ? t("removeFavorite") : t("addFavorite")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void setDefault(isDefault ? undefined : view.id)
                .then(() =>
                  toast.success(
                    isDefault ? t("defaultCleared") : t("defaultSet"),
                  ),
                )
                .catch(report);
            }}
          >
            {isDefault ? t("unsetDefault") : t("setDefault")}
          </DropdownMenuItem>
          {updatePayload ? (
            <DropdownMenuItem
              onSelect={() => router.push(withVault(vault, "/views"))}
            >
              {t("manage")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => {
              remove.reset();
              setDeleteOpen(true);
            }}
          >
            {c("delete")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
            {t("owner", { owner: view.owner })}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => !update.isPending && setRenameOpen(open)}
      >
        <DialogContent className="max-w-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void update
                .mutateAsync({ id: view.id, patch: { name: renameValue } })
                .then(() => {
                  setRenameOpen(false);
                  toast.success(t("renamed"));
                })
                .catch(() => undefined);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("rename")}</DialogTitle>
              <DialogDescription>{t("renameDescription")}</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <label
                htmlFor={`saved-view-rename-${view.id}`}
                className="mb-1.5 block text-xs font-medium"
              >
                {t("name")}
              </label>
              <Input
                id={`saved-view-rename-${view.id}`}
                name="savedViewName"
                autoFocus
                autoComplete="off"
                maxLength={120}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-invalid={update.isError}
              />
              {update.error ? (
                <p role="alert" className="mt-1.5 text-xs text-destructive">
                  {update.error.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={update.isPending}
                onClick={() => setRenameOpen(false)}
              >
                {c("cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!renameValue.trim() || update.isPending}
              >
                {update.isPending ? (
                  <>
                    <Spinner className="size-3.5" aria-hidden="true" />
                    {t("saving")}
                  </>
                ) : (
                  c("save")
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !remove.isPending && setDeleteOpen(open)}
      >
        <DialogContent
          className="max-w-sm"
          onEscapeKeyDown={(event) => {
            if (remove.isPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (remove.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { name: view.name })}
            </DialogDescription>
          </DialogHeader>
          {remove.error ? (
            <p role="alert" className="text-xs text-destructive">
              {remove.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              autoFocus
              disabled={remove.isPending}
              onClick={() => setDeleteOpen(false)}
            >
              {c("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                void remove
                  .mutateAsync(view.id)
                  .then(() => {
                    setDeleteOpen(false);
                    toast.success(t("deleted"));
                  })
                  .catch(() => undefined);
              }}
            >
              {remove.isPending ? (
                <>
                  <Spinner className="size-3.5" aria-hidden="true" />
                  {t("deleting")}
                </>
              ) : (
                c("delete")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
