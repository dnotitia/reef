"use client";

import { Button } from "@/components/ui/button";
import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
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
  ChevronDown,
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type RefObject,
  type SyntheticEvent,
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
      action();
      setOpen(false);
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
        <>
          <div className="px-2 py-2 text-xs text-destructive-text" role="alert">
            {t("loadError")}
          </div>
          <DropdownMenuItem onSelect={onRetry}>{t("retry")}</DropdownMenuItem>
        </>
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
              <div className="space-y-0.5" key={item.id}>
                <DropdownMenuItem
                  aria-current={isActive ? "true" : undefined}
                  className="min-w-0"
                  disabled={!item.applicable}
                  onSelect={() => closeAnd(() => onApply(item))}
                  selected={isActive}
                  title={item.name}
                  trailing={
                    !item.applicable ? (
                      <span className="text-[11px] text-muted-foreground">
                        {t("unavailable")}
                      </span>
                    ) : isActive ? (
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          activeChanged
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-brand-text",
                        )}
                      >
                        {activeChanged ? t("changed") : t("active")}
                      </span>
                    ) : undefined
                  }
                >
                  <span className="block min-w-0 truncate">{item.name}</span>
                </DropdownMenuItem>

                <DropdownMenuLabel className="pl-8 text-[11px]">
                  {t("manage", { name: item.name })}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="pl-8"
                  disabled={updateDisabled}
                  leading={
                    updatingId === item.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )
                  }
                  onSelect={() => closeAnd(onUpdate)}
                >
                  <span className="min-w-0 truncate">
                    {t("update", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  leading={<Pencil className="size-3.5" />}
                  onSelect={() => closeAnd(() => onRename(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("rename", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  leading={<Copy className="size-3.5" />}
                  onSelect={() => closeAnd(() => onDuplicate(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("duplicate", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  destructive
                  leading={<Trash2 className="size-3.5" />}
                  onSelect={() => closeAnd(() => onDelete(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("deleteNamed", { name: item.name })}
                  </span>
                </DropdownMenuItem>
              </div>
            );
          })}
        </div>
      )}

      {actionError ? (
        <div className="px-2 py-2 text-xs text-destructive-text" role="alert">
          {actionError}
        </div>
      ) : null}

      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!canSave}
        leading={<Plus aria-hidden="true" className="size-3.5" />}
        onSelect={canSave ? onSave : undefined}
      >
        {t("saveCurrent")}
      </DropdownMenuItem>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("scopeNotice")}
      </div>
    </DropdownMenuContent>
  );
}

interface NamedFilterTriggerProps {
  activeChanged: boolean;
  activeItem: NamedIssueFilter | undefined;
  disabled: boolean;
  triggerAria: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerText: string;
}

function NamedFilterTrigger({
  activeChanged,
  activeItem,
  disabled,
  triggerAria,
  triggerRef,
  triggerText,
}: NamedFilterTriggerProps) {
  const { open } = useDropdownMenu();

  return (
    <DropdownMenuTrigger
      ref={triggerRef}
      aria-label={triggerAria}
      className={cn(
        CBX_TRIGGER_CHIP,
        activeItem ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
        "max-w-[18rem]",
      )}
      data-testid="named-filter-trigger"
      disabled={disabled}
    >
      <span className="min-w-0 truncate" title={activeItem?.name}>
        {triggerText}
      </span>
      {activeItem ? (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            activeChanged ? "bg-amber-500" : "bg-brand-fill",
          )}
          aria-hidden="true"
          data-testid={
            activeChanged
              ? "named-filter-changed-dot"
              : "named-filter-active-dot"
          }
        />
      ) : null}
      <ChevronDown
        data-open={open}
        aria-hidden="true"
        className={CBX_CHEVRON}
      />
    </DropdownMenuTrigger>
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
    void Promise.resolve().then(loadItems);
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
  }, []);

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
    async (event: SyntheticEvent<HTMLFormElement>) => {
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
        <NamedFilterTrigger
          activeChanged={activeChanged}
          activeItem={activeItem}
          disabled={!vault}
          triggerAria={triggerAria}
          triggerRef={triggerRef}
          triggerText={triggerText}
        />
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
        <DialogContent
          data-testid="named-filter-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => triggerRef.current?.focus());
          }}
        >
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
                className="h-9 rounded-md border border-border bg-surface-page px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
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
                className="mt-2 text-xs text-destructive-text"
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
            <p className="text-xs text-destructive-text" role="alert">
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
