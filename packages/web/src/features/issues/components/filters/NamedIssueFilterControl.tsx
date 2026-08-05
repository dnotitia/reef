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
  useDropdownMenu,
} from "@/components/ui/dropdown-menu";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  type NamedIssueFilter,
  NamedIssueFilterError,
  createNamedIssueFilter,
  deleteNamedIssueFilter,
  listNamedIssueFilters,
  updateNamedIssueFilter,
} from "@/lib/storage/namedIssueFilter";
import { cn } from "@/lib/utils";
import {
  hasNamedIssueFilterPayload,
  serializeNamedIssueFilterPayload,
} from "@reef/core";
import {
  Bookmark,
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { IssueFilter } from "../../stores/useIssueStore";

type NameDialogKind = "save" | "rename" | "duplicate";

interface NameDialogState {
  kind: NameDialogKind;
  item?: NamedIssueFilter;
}

function sortNamedFilters(
  items: readonly NamedIssueFilter[],
): NamedIssueFilter[] {
  return [...items].sort((left, right) =>
    left.nameKey === right.nameKey
      ? left.id.localeCompare(right.id)
      : left.nameKey.localeCompare(right.nameKey),
  );
}

function errorCode(error: unknown): NamedIssueFilterError["code"] | null {
  return error instanceof NamedIssueFilterError ? error.code : null;
}

interface NamedFilterMenuProps {
  items: readonly NamedIssueFilter[];
  activeItem: NamedIssueFilter | undefined;
  activeChanged: boolean;
  canSave: boolean;
  actionError: string | null;
  updatingId: string | null;
  onApply: (item: NamedIssueFilter) => void;
  onSave: () => void;
  onRename: (item: NamedIssueFilter) => void;
  onDuplicate: (item: NamedIssueFilter) => void;
  onDelete: (item: NamedIssueFilter) => void;
  onUpdate: () => void;
  onRetry: () => void;
  loadError: boolean;
}

function NamedFilterMenu({
  items,
  activeItem,
  activeChanged,
  canSave,
  actionError,
  updatingId,
  onApply,
  onSave,
  onRename,
  onDuplicate,
  onDelete,
  onUpdate,
  onRetry,
  loadError,
}: NamedFilterMenuProps) {
  const { setOpen } = useDropdownMenu();
  const t = useTranslations("issues.filters");

  const closeAnd = useCallback(
    (action: () => void) => {
      setOpen(false);
      action();
    },
    [setOpen],
  );

  return (
    <DropdownMenuContent
      align="start"
      className="min-w-[22rem] max-w-[min(92vw,34rem)]"
      data-testid="named-filter-menu"
    >
      <DropdownMenuLabel>{t("namedFilters")}</DropdownMenuLabel>

      {loadError ? (
        <div
          className="flex items-center gap-2 px-2 py-2 text-xs text-destructive"
          role="alert"
        >
          <span className="min-w-0 flex-1">{t("loadError")}</span>
          <button
            type="button"
            role="menuitem"
            className="shrink-0 rounded px-1.5 py-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            onClick={onRetry}
          >
            {t("retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div
          aria-live="polite"
          className="px-2 py-2 text-xs text-muted-foreground"
        >
          {t("noSaved")}
        </div>
      ) : (
        <div className="max-h-[min(18rem,50vh)] overflow-y-auto">
          {items.map((item) => {
            const isActive = activeItem?.id === item.id;
            const updateDisabled =
              !isActive || !item.applicable || !canSave || updatingId !== null;
            return (
              <div
                className="flex items-center gap-1 rounded-sm p-0.5 hover:bg-surface-hover"
                key={item.id}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  aria-current={isActive ? "true" : undefined}
                  disabled={!item.applicable}
                  onClick={() => closeAnd(() => onApply(item))}
                  title={item.name}
                >
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {!item.applicable ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("unavailable")}
                    </span>
                  ) : isActive ? (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-medium",
                        activeChanged
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-brand",
                      )}
                    >
                      {activeChanged ? t("changed") : t("active")}
                    </span>
                  ) : null}
                </button>
                <fieldset
                  className="m-0 flex min-w-0 shrink-0 items-center border-0 p-0"
                  aria-label={t("manage", { name: item.name })}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-40"
                    aria-label={t("update", { name: item.name })}
                    disabled={updateDisabled}
                    onClick={() => closeAnd(onUpdate)}
                    title={t("update", { name: item.name })}
                  >
                    {updatingId === item.id ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-3.5 animate-spin"
                      />
                    ) : (
                      <RefreshCw aria-hidden="true" className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label={t("rename", { name: item.name })}
                    onClick={() => closeAnd(() => onRename(item))}
                    title={t("rename", { name: item.name })}
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label={t("duplicate", { name: item.name })}
                    onClick={() => closeAnd(() => onDuplicate(item))}
                    title={t("duplicate", { name: item.name })}
                  >
                    <Copy aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label={t("deleteNamed", { name: item.name })}
                    onClick={() => closeAnd(() => onDelete(item))}
                    title={t("deleteNamed", { name: item.name })}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                </fieldset>
              </div>
            );
          })}
        </div>
      )}

      {actionError ? (
        <div className="px-2 py-2 text-xs text-destructive" role="alert">
          {actionError}
        </div>
      ) : null}

      <DropdownMenuSeparator />
      <DropdownMenuItem
        aria-disabled={!canSave}
        className="gap-2"
        onSelect={canSave ? onSave : undefined}
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {t("saveCurrent")}
      </DropdownMenuItem>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("scopeNotice")}
      </div>
    </DropdownMenuContent>
  );
}

export function NamedIssueFilterControl() {
  const t = useTranslations("issues.filters");
  const { vault } = useActiveVault();
  const filter = useIssueStore((state) => state.filter);
  const applyFilter = useIssueStore((state) => state.applyFilter);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<NamedIssueFilter[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<NameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NamedIssueFilter | null>(
    null,
  );
  const [draftName, setDraftName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const filterPayload = useMemo(
    () => serializeNamedIssueFilterPayload(filter),
    [filter],
  );
  const canSave = hasNamedIssueFilterPayload(filter);
  const exactMatch = useMemo(
    () =>
      items.find(
        (item) =>
          item.applicable &&
          serializeNamedIssueFilterPayload(item.payload) === filterPayload,
      ),
    [filterPayload, items],
  );
  const activeItem = useMemo(
    () => exactMatch ?? items.find((item) => item.id === activeId),
    [activeId, exactMatch, items],
  );
  const activeChanged = Boolean(
    activeItem &&
      serializeNamedIssueFilterPayload(activeItem.payload) !== filterPayload,
  );

  const restoreTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const loadItems = useCallback(async () => {
    if (!vault) {
      setItems([]);
      setLoadError(false);
      setActiveId(null);
      return;
    }
    try {
      setLoadError(false);
      const loaded = await listNamedIssueFilters(vault);
      setItems(loaded);
      const currentPayload = serializeNamedIssueFilterPayload(
        useIssueStore.getState().filter,
      );
      const restoredActive = loaded.find(
        (item) =>
          item.applicable &&
          serializeNamedIssueFilterPayload(item.payload) === currentPayload,
      );
      setActiveId(restoredActive?.id ?? null);
    } catch {
      setLoadError(true);
    }
  }, [vault]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!dialog) return;
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [dialog]);

  const openNameDialog = useCallback(
    (kind: NameDialogKind, item?: NamedIssueFilter) => {
      setDialog({ kind, item });
      setDialogError(null);
      setDraftName(
        kind === "duplicate" && item
          ? `${item.name} ${t("copySuffix")}`
          : kind === "rename" && item
            ? item.name
            : "",
      );
    },
    [t],
  );

  const closeNameDialog = useCallback(() => {
    setDialog(null);
    setDialogError(null);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const handleApply = useCallback(
    (item: NamedIssueFilter) => {
      applyFilter(item.payload as IssueFilter);
      setActiveId(item.id);
      setActionError(null);
    },
    [applyFilter],
  );

  const handleUpdate = useCallback(async () => {
    if (!vault || !activeItem || !canSave || updatingId) return;
    setUpdatingId(activeItem.id);
    setActionError(null);
    try {
      const updated = await updateNamedIssueFilter({
        vault,
        id: activeItem.id,
        payload: filter,
      });
      setItems((current) =>
        sortNamedFilters(
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      );
    } catch (error) {
      const code = errorCode(error);
      setActionError(
        code === "not_found" ? t("notFoundError") : t("updateError"),
      );
    } finally {
      setUpdatingId(null);
    }
  }, [activeItem, canSave, filter, t, updatingId, vault]);

  const handleDialogSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!vault || !dialog) return;
      const name = draftName.normalize("NFKC").trim();
      if (!name) {
        setDialogError(t("nameRequired"));
        return;
      }
      setDialogPending(true);
      setDialogError(null);
      try {
        let saved: NamedIssueFilter;
        if (dialog.kind === "save") {
          saved = await createNamedIssueFilter({
            vault,
            name,
            payload: filter,
          });
          setActiveId(saved.id);
        } else if (dialog.kind === "duplicate" && dialog.item) {
          saved = await createNamedIssueFilter({
            vault,
            name,
            payload: dialog.item.payload,
          });
        } else if (dialog.kind === "rename" && dialog.item) {
          saved = await updateNamedIssueFilter({
            vault,
            id: dialog.item.id,
            name,
          });
          if (activeId === saved.id) setActiveId(saved.id);
        } else {
          return;
        }
        setItems((current) =>
          sortNamedFilters(
            dialog.kind === "save" || dialog.kind === "duplicate"
              ? [...current, saved]
              : current.map((item) => (item.id === saved.id ? saved : item)),
          ),
        );
        closeNameDialog();
      } catch (error) {
        const code = errorCode(error);
        setDialogError(
          code === "duplicate"
            ? t("duplicateError")
            : code === "not_found"
              ? t("notFoundError")
              : dialog.kind === "save"
                ? t("saveError")
                : dialog.kind === "duplicate"
                  ? t("duplicateError")
                  : t("renameError"),
        );
      } finally {
        setDialogPending(false);
      }
    },
    [activeId, closeNameDialog, dialog, draftName, filter, t, vault],
  );

  const confirmDelete = useCallback(async () => {
    if (!vault || !deleteTarget) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteNamedIssueFilter({ vault, id: deleteTarget.id });
      setItems((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      if (activeId === deleteTarget.id) setActiveId(null);
      setDeleteTarget(null);
      restoreTriggerFocus();
    } catch (error) {
      const code = errorCode(error);
      setDeleteError(
        code === "not_found" ? t("notFoundError") : t("deleteError"),
      );
    } finally {
      setDeletePending(false);
    }
  }, [activeId, deleteTarget, restoreTriggerFocus, t, vault]);

  const triggerText = activeItem?.name ?? t("namedFilters");
  const triggerAria = activeItem
    ? `${t("namedFilters")}: ${activeItem.name}, ${activeChanged ? t("changed") : t("active")}`
    : t("namedFilterMenu");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={triggerAria}
          className={cn(
            "h-8 max-w-[18rem] gap-1.5 rounded-md border border-border bg-elevated px-2.5 text-xs text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
            activeItem && "border-brand/40",
          )}
          data-testid="named-filter-trigger"
          disabled={!vault}
        >
          <Bookmark aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate" title={activeItem?.name}>
            {triggerText}
          </span>
          {activeItem ? (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                activeChanged ? "bg-amber-500" : "bg-brand",
              )}
              aria-hidden="true"
              data-testid={
                activeChanged
                  ? "named-filter-changed-dot"
                  : "named-filter-active-dot"
              }
            />
          ) : null}
        </DropdownMenuTrigger>
        <NamedFilterMenu
          actionError={actionError}
          activeChanged={activeChanged}
          activeItem={activeItem}
          canSave={canSave}
          items={items}
          loadError={loadError}
          onApply={handleApply}
          onDelete={(item) => {
            setDeleteError(null);
            setDeleteTarget(item);
          }}
          onDuplicate={(item) => openNameDialog("duplicate", item)}
          onRename={(item) => openNameDialog("rename", item)}
          onRetry={() => void loadItems()}
          onSave={() => openNameDialog("save")}
          onUpdate={() => void handleUpdate()}
          updatingId={updatingId}
        />
      </DropdownMenu>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeNameDialog();
        }}
      >
        <DialogContent data-testid="named-filter-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "save"
                ? t("saveTitle")
                : dialog?.kind === "rename"
                  ? t("renameTitle")
                  : t("duplicateTitle")}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "save"
                ? t("saveDescription")
                : t("nameDescription")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDialogSubmit}>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="named-filter-name"
            >
              {t("nameLabel")}
              <input
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                id="named-filter-name"
                maxLength={80}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={t("namePlaceholder")}
                ref={nameInputRef}
                value={draftName}
                aria-describedby={
                  dialogError ? "named-filter-dialog-error" : undefined
                }
                aria-invalid={dialogError ? "true" : undefined}
                data-testid="named-filter-name-input"
              />
            </label>
            {dialogError ? (
              <p
                className="mt-2 text-xs text-destructive"
                id="named-filter-dialog-error"
                role="alert"
              >
                {dialogError}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={closeNameDialog}
                disabled={dialogPending}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="brand"
                disabled={dialogPending || !vault}
              >
                {dialogPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-3.5 animate-spin"
                  />
                ) : null}
                {dialog?.kind === "rename" ? t("renameAction") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
            restoreTriggerFocus();
          }
        }}
      >
        <DialogContent data-testid="named-filter-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirmDescription", {
                name: deleteTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
                restoreTriggerFocus();
              }}
              disabled={deletePending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletePending || !deleteTarget}
              data-testid="named-filter-confirm-delete"
            >
              {deletePending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin"
                />
              ) : (
                <Trash2 aria-hidden="true" className="size-3.5" />
              )}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
