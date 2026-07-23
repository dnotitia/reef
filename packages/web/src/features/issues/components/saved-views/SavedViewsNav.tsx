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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  useDeleteSavedIssueView,
  useUpdateSavedIssueView,
} from "@/features/issues/hooks/mutations/useSavedIssueViewMutations";
import { useSavedIssueViews } from "@/features/issues/hooks/queries/useSavedIssueViews";
import {
  createSavedIssueViewPayload,
  isIssuesListPath,
  savedIssueViewDefaultIsStale,
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
  const [defaultSelection, setDefaultSelection] = useState<{
    vault: string;
    id?: string;
  }>();
  const [rename, setRename] = useState<SavedIssueView | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<SavedIssueView | null>(null);
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");
  const defaultId =
    defaultSelection?.vault === vault ? defaultSelection.id : undefined;

  useEffect(() => {
    let live = true;
    void getDefaultIssueViewId(vault).then((value) => {
      if (live) setDefaultSelection({ vault, id: value });
    });
    return () => {
      live = false;
    };
  }, [vault]);

  useEffect(() => {
    if (
      savedIssueViewDefaultIsStale(
        defaultId,
        query.data,
        query.isSuccess && !query.isFetching,
      )
    ) {
      void clearDefaultIssueViewId(vault);
      setDefaultSelection({ vault });
    }
  }, [defaultId, query.data, query.isFetching, query.isSuccess, vault]);

  if (query.isPending) {
    return (
      <li
        className="ml-4 mt-1"
        data-testid="saved-views-loading"
        aria-label={t("loading")}
      >
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          {t("views")}
        </p>
        <div className="space-y-1 px-2" aria-hidden="true">
          {[0, 1].map((index) => (
            <Skeleton
              key={index}
              data-testid="saved-view-skeleton"
              className="h-6 w-full"
              style={{ "--i": index } as React.CSSProperties}
            />
          ))}
        </div>
      </li>
    );
  }
  if (query.isError) {
    return (
      <li className="ml-4 mt-1 px-2">
        <p className="text-xs text-muted-foreground" role="alert">
          {t("loadError")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-0.5 h-7 px-1.5 text-xs"
          onClick={() => void query.refetch()}
        >
          {c("retry")}
        </Button>
      </li>
    );
  }
  if (!query.data?.length) return null;

  const report = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("error"));
  const isIssuesList = isIssuesListPath(pathname, vault);

  return (
    <>
      <li className="ml-4 mt-1 min-w-0" data-testid="saved-views-nav">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          {t("views")}
        </p>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
          {query.data.map((view) => {
            const active =
              isIssuesList &&
              savedIssueViewIsActive(view.payload, searchParams);
            return (
              <li key={view.id} className="group flex items-center">
                <Link
                  href={savedIssueViewHref(vault, view.payload)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    active
                      ? "bg-surface-hover font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={view.name}
                >
                  {defaultId === view.id ? (
                    <>
                      <span className="sr-only">{t("default")}</span>
                      <Star
                        className="mr-1 inline size-3 fill-current"
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                  {view.name}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="size-7 justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                    aria-label={t("actions", { name: view.name })}
                  >
                    <MoreHorizontal className="size-3.5" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="right-0 left-auto">
                    {isIssuesList ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          update.reset();
                          void update
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
                          .then(() => {
                            setDefaultSelection({ vault, id: next });
                            toast.success(
                              next ? t("defaultSet") : t("defaultCleared"),
                            );
                          })
                          .catch(report);
                      }}
                    >
                      {defaultId === view.id
                        ? t("unsetDefault")
                        : t("setDefault")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => {
                        remove.reset();
                        setDeleting(view);
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
              </li>
            );
          })}
        </ul>
      </li>

      <Dialog
        open={rename !== null}
        onOpenChange={(open) => !open && !update.isPending && setRename(null)}
      >
        <DialogContent className="max-w-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!rename) return;
              void update
                .mutateAsync({ id: rename.id, patch: { name: renameValue } })
                .then(() => {
                  setRename(null);
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
                htmlFor="saved-view-rename"
                className="mb-1.5 block text-xs font-medium"
              >
                {t("name")}
              </label>
              <Input
                id="saved-view-rename"
                autoFocus
                name="saved-view-rename"
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
                onClick={() => setRename(null)}
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
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}
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
              size="sm"
              autoFocus
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              {c("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                void remove
                  .mutateAsync(deleting.id)
                  .then(() => {
                    if (defaultId === deleting.id) {
                      setDefaultSelection({ vault });
                    }
                    setDeleting(null);
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
