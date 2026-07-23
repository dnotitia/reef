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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  useDeleteSavedIssueView,
  useUpdateSavedIssueView,
} from "@/features/issues/hooks/mutations/useSavedIssueViewMutations";
import { useSavedIssueViews } from "@/features/issues/hooks/queries/useSavedIssueViews";
import {
  createSavedIssueViewPayload,
  savedIssueViewHref,
  savedIssueViewIsActive,
} from "@/features/issues/lib/issueViewCodec";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import {
  clearDefaultIssueViewId,
  getDefaultIssueViewId,
  setDefaultIssueViewId,
} from "@/lib/storage/config";
import { cn } from "@/lib/utils";
import type { SavedIssueView } from "@reef/core";
import { MoreHorizontal, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function SavedViewsNav({ vault }: { vault: string }) {
  const query = useSavedIssueViews(vault);
  const update = useUpdateSavedIssueView(vault);
  const remove = useDeleteSavedIssueView(vault);
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [defaultId, setDefaultId] = useState<string>();
  const [rename, setRename] = useState<SavedIssueView | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<SavedIssueView | null>(null);
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");

  useEffect(() => {
    let live = true;
    void getDefaultIssueViewId(vault).then((value) => {
      if (live) setDefaultId(value);
    });
    return () => {
      live = false;
    };
  }, [vault]);

  useEffect(() => {
    if (!defaultId || query.isPending) return;
    if (!(query.data ?? []).some((view) => view.id === defaultId)) {
      void clearDefaultIssueViewId(vault);
      setDefaultId(undefined);
    }
  }, [defaultId, query.data, query.isPending, vault]);

  if (query.isPending) {
    return (
      <li>
        <p className="px-3 py-1 text-[11px] text-muted-foreground">
          {c("loading")}
        </p>
      </li>
    );
  }
  if (query.isError || !query.data?.length) return null;

  const report = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("error"));

  return (
    <>
      <li
        className="mt-2 border-t border-border-subtle pt-2"
        data-testid="saved-views-nav"
      >
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("views")}
        </p>
        <ul className="space-y-0.5">
          {query.data.map((view) => {
            const active =
              pathname.endsWith("/issues") &&
              savedIssueViewIsActive(view.payload, searchParams);
            return (
              <li key={view.id} className="group flex items-center">
                <Link
                  href={savedIssueViewHref(vault, view.payload)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-3 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    active
                      ? "bg-surface-hover font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={view.name}
                >
                  {defaultId === view.id ? (
                    <Star
                      className="mr-1 inline size-3 fill-current"
                      aria-hidden="true"
                    />
                  ) : null}
                  {view.name}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="size-7 justify-center rounded-md text-muted-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label={t("actions", { name: view.name })}
                  >
                    <MoreHorizontal className="size-3.5" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="right-0 left-auto">
                    <DropdownMenuItem
                      onSelect={() =>
                        update
                          .mutateAsync({
                            id: view.id,
                            patch: {
                              payload: createSavedIssueViewPayload(
                                filter,
                                searchQuery,
                                searchParams.get("view") ?? "board",
                              ),
                            },
                          })
                          .catch(report)
                      }
                    >
                      {t("updateCurrent")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRename(view);
                        setRenameValue(view.name);
                      }}
                    >
                      {t("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const next =
                          defaultId === view.id ? undefined : view.id;
                        const operation = next
                          ? setDefaultIssueViewId(vault, next)
                          : clearDefaultIssueViewId(vault);
                        void operation
                          .then(() => setDefaultId(next))
                          .catch(report);
                      }}
                    >
                      {defaultId === view.id
                        ? t("unsetDefault")
                        : t("setDefault")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setDeleting(view)}
                    >
                      {c("delete")}
                    </DropdownMenuItem>
                    <p className="px-2 py-1 text-[10px] text-muted-foreground">
                      {t("owner", { owner: view.owner })}
                    </p>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </li>

      <Dialog
        open={rename !== null}
        onOpenChange={(open) => !open && setRename(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
            <DialogDescription>{t("renameDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("name")}
            name="saved-view-rename"
            autoComplete="off"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          {update.error ? (
            <p role="alert" className="text-xs text-destructive">
              {update.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(null)}>
              {c("cancel")}
            </Button>
            <Button
              disabled={!renameValue.trim() || update.isPending}
              onClick={() => {
                if (!rename) return;
                void update
                  .mutateAsync({ id: rename.id, patch: { name: renameValue } })
                  .then(() => setRename(null))
                  .catch(() => undefined);
              }}
            >
              {update.isPending ? t("saving") : c("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { name: deleting?.name ?? "" })}
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
              autoFocus
              onClick={() => setDeleting(null)}
            >
              {c("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                void remove
                  .mutateAsync(deleting.id)
                  .then(() => {
                    if (defaultId === deleting.id) setDefaultId(undefined);
                    setDeleting(null);
                  })
                  .catch(() => undefined);
              }}
            >
              {c("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
