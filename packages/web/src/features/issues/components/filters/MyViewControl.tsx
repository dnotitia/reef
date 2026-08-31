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
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  type MyView,
  MyViewError,
  createMyView,
  deleteMyView,
  listMyViews,
  updateMyView,
} from "@/lib/storage/myView";
import { cn } from "@/lib/utils";
import {
  type MyViewListColumn,
  type MyViewSnapshot,
  serializeMyViewSnapshot,
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
import { buildMyViewSnapshot } from "../../lib/myViewSnapshot";
import type { IssueGroupBy } from "../../lib/groupBy";
import type { IssueLayout, IssueScope } from "../../lib/viewMode";
import { type IssueFilter, useIssueStore } from "../../stores/useIssueStore";

type NameDialogKind = "save" | "rename" | "duplicate";

interface NameDialogState {
  kind: NameDialogKind;
  item?: MyView;
}

interface MyViewControlProps {
  scope: IssueScope;
  layout: IssueLayout;
  groupBy?: IssueGroupBy;
  listOptionalColumns?: readonly MyViewListColumn[];
  onApplySnapshot: (snapshot: MyViewSnapshot) => void;
}

function sortMyViews(items: readonly MyView[]): MyView[] {
  return [...items].sort((left, right) =>
    left.nameKey === right.nameKey
      ? left.id.localeCompare(right.id)
      : left.nameKey.localeCompare(right.nameKey),
  );
}

function errorCode(error: unknown): MyViewError["code"] | null {
  return error instanceof MyViewError ? error.code : null;
}

interface MyViewMenuProps {
  items: readonly MyView[];
  activeItem: MyView | undefined;
  activeChanged: boolean;
  canSave: boolean;
  actionError: string | null;
  updatingId: string | null;
  onApply: (item: MyView) => void;
  onSave: () => void;
  onRename: (item: MyView) => void;
  onDuplicate: (item: MyView) => void;
  onDelete: (item: MyView) => void;
  onUpdate: () => void;
  onRetry: () => void;
  loadError: boolean;
}

function MyViewMenu({
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
}: MyViewMenuProps) {
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
      data-testid="my-view-menu"
    >
      <DropdownMenuLabel>{t("myViews")}</DropdownMenuLabel>

      {loadError ? (
        <>
          <div className="px-2 py-2 text-xs text-destructive-text" role="alert">
            {t("loadViewsError")}
          </div>
          <DropdownMenuItem onSelect={onRetry}>{t("retry")}</DropdownMenuItem>
        </>
      ) : items.length === 0 ? (
        <div
          aria-live="polite"
          className="px-2 py-2 text-xs text-muted-foreground"
        >
          {t("noSavedViews")}
        </div>
      ) : (
        <div className="max-h-[min(18rem,50vh)] overflow-y-auto">
          {items.map((item) => {
            const isActive = activeItem?.id === item.id;
            const updateDisabled = !isActive || !canSave || updatingId !== null;
            return (
              <div className="space-y-0.5" key={item.id}>
                <DropdownMenuItem
                  aria-current={isActive ? "true" : undefined}
                  className="min-w-0"
                  onSelect={() => closeAnd(() => onApply(item))}
                  selected={isActive}
                  title={item.name}
                  trailing={
                    isActive ? (
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
                    {t("updateView", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  leading={<Pencil className="size-3.5" />}
                  onSelect={() => closeAnd(() => onRename(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("renameView", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  leading={<Copy className="size-3.5" />}
                  onSelect={() => closeAnd(() => onDuplicate(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("duplicateView", { name: item.name })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pl-8"
                  destructive
                  leading={<Trash2 className="size-3.5" />}
                  onSelect={() => closeAnd(() => onDelete(item))}
                >
                  <span className="min-w-0 truncate">
                    {t("deleteView", { name: item.name })}
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
        {t("saveCurrentView")}
      </DropdownMenuItem>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("viewScopeNotice")}
      </div>
    </DropdownMenuContent>
  );
}

interface MyViewTriggerProps {
  activeChanged: boolean;
  activeItem: MyView | undefined;
  busy: boolean;
  disabled: boolean;
  triggerAria: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerText: string;
}

function MyViewTrigger({
  activeChanged,
  activeItem,
  busy,
  disabled,
  triggerAria,
  triggerRef,
  triggerText,
}: MyViewTriggerProps) {
  const { open } = useDropdownMenu();

  return (
    <DropdownMenuTrigger
      ref={triggerRef}
      aria-label={triggerAria}
      aria-busy={busy || undefined}
      className={cn(
        CBX_TRIGGER_CHIP,
        activeItem ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
        "max-w-[18rem]",
      )}
      data-testid="my-view-trigger"
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
            activeChanged ? "my-view-changed-dot" : "my-view-active-dot"
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

export function MyViewControl({
  scope,
  layout,
  groupBy,
  listOptionalColumns = [],
  onApplySnapshot,
}: MyViewControlProps) {
  const t = useTranslations("issues.filters");
  const { vault } = useActiveVault();
  const actor = useCurrentUserLogin();
  const filter = useIssueStore((state) => state.filter);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MyView[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<NameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MyView | null>(null);
  const [draftName, setDraftName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const loadGeneration = useRef(0);
  const ownerKey = `${actor ?? ""}\u0000${vault}`;
  const [loadedOwnerKey, setLoadedOwnerKey] = useState("");

  const currentSnapshot = useMemo(
    () =>
      buildMyViewSnapshot({
        filter,
        scope,
        layout,
        groupBy,
        listOptionalColumns,
      }),
    [filter, groupBy, layout, listOptionalColumns, scope],
  );
  const currentSnapshotText = useMemo(
    () => serializeMyViewSnapshot(currentSnapshot),
    [currentSnapshot],
  );
  const currentSnapshotTextRef = useRef(currentSnapshotText);
  useEffect(() => {
    currentSnapshotTextRef.current = currentSnapshotText;
  }, [currentSnapshotText]);
  const canSave = Boolean(actor && vault);
  const scopedItems = loadedOwnerKey === ownerKey ? items : [];
  const exactMatch = useMemo(
    () =>
      scopedItems.find(
        (item) =>
          serializeMyViewSnapshot(item.snapshot) === currentSnapshotText,
      ),
    [currentSnapshotText, scopedItems],
  );
  const activeItem = useMemo(
    () => exactMatch ?? scopedItems.find((item) => item.id === activeId),
    [activeId, exactMatch, scopedItems],
  );
  const activeChanged = Boolean(
    activeItem &&
      serializeMyViewSnapshot(activeItem.snapshot) !== currentSnapshotText,
  );

  const restoreTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const loadItems = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!actor || !vault) {
      if (generation !== loadGeneration.current) return;
      setItems([]);
      setLoadedOwnerKey(ownerKey);
      setLoadError(false);
      setActiveId(null);
      return;
    }
    try {
      setLoadError(false);
      const loaded = await listMyViews(actor, vault);
      if (generation !== loadGeneration.current) return;
      setItems(loaded);
      setLoadedOwnerKey(ownerKey);
      if (generation !== loadGeneration.current) return;
      const restoredActive = loaded.find(
        (item) =>
          serializeMyViewSnapshot(item.snapshot) ===
          currentSnapshotTextRef.current,
      );
      setActiveId(restoredActive?.id ?? null);
    } catch {
      setLoadError(true);
    }
  }, [actor, ownerKey, vault]);

  useEffect(() => {
    void Promise.resolve().then(loadItems);
  }, [loadItems]);

  useEffect(() => {
    if (!dialog) return;
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [dialog]);

  const openNameDialog = useCallback(
    (kind: NameDialogKind, item?: MyView) => {
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
    (item: MyView) => {
      onApplySnapshot(item.snapshot);
      setActiveId(item.id);
      setActionError(null);
    },
    [onApplySnapshot],
  );

  const handleUpdate = useCallback(async () => {
    if (!actor || !vault || !activeItem || !canSave || updatingId) return;
    loadGeneration.current += 1;
    setUpdatingId(activeItem.id);
    setActionError(null);
    try {
      const updated = await updateMyView({
        actor,
        vault,
        id: activeItem.id,
        snapshot: currentSnapshot,
      });
      loadGeneration.current += 1;
      setItems((current) =>
        sortMyViews(
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      );
    } catch (error) {
      const code = errorCode(error);
      setActionError(
        code === "not_found" ? t("viewNotFoundError") : t("updateViewError"),
      );
    } finally {
      setUpdatingId(null);
    }
  }, [actor, activeItem, canSave, currentSnapshot, t, updatingId, vault]);

  const handleDialogSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!actor || !vault || !dialog) return;
      const name = draftName.normalize("NFKC").trim();
      if (!name) {
        setDialogError(t("viewNameRequired"));
        return;
      }
      setDialogPending(true);
      setDialogError(null);
      loadGeneration.current += 1;
      try {
        let saved: MyView;
        if (dialog.kind === "save") {
          saved = await createMyView({
            actor,
            vault,
            name,
            snapshot: currentSnapshot,
          });
          setActiveId(saved.id);
        } else if (dialog.kind === "duplicate" && dialog.item) {
          saved = await createMyView({
            actor,
            vault,
            name,
            snapshot: dialog.item.snapshot,
          });
        } else if (dialog.kind === "rename" && dialog.item) {
          saved = await updateMyView({
            actor,
            vault,
            id: dialog.item.id,
            name,
          });
          if (activeId === saved.id) setActiveId(saved.id);
        } else {
          return;
        }
        loadGeneration.current += 1;
        setItems((current) =>
          sortMyViews(
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
            ? t("viewDuplicateError")
            : code === "not_found"
              ? t("viewNotFoundError")
              : dialog.kind === "save"
                ? t("saveViewError")
                : dialog.kind === "duplicate"
                  ? t("duplicateViewError")
                  : t("renameViewError"),
        );
      } finally {
        setDialogPending(false);
      }
    },
    [
      activeId,
      actor,
      closeNameDialog,
      currentSnapshot,
      dialog,
      draftName,
      t,
      vault,
    ],
  );

  const confirmDelete = useCallback(async () => {
    if (!actor || !vault || !deleteTarget) return;
    loadGeneration.current += 1;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteMyView({ actor, vault, id: deleteTarget.id });
      loadGeneration.current += 1;
      setItems((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      if (activeId === deleteTarget.id) setActiveId(null);
      setDeleteTarget(null);
      restoreTriggerFocus();
    } catch (error) {
      const code = errorCode(error);
      setDeleteError(
        code === "not_found" ? t("viewNotFoundError") : t("deleteViewError"),
      );
    } finally {
      setDeletePending(false);
    }
  }, [actor, activeId, deleteTarget, restoreTriggerFocus, t, vault]);

  const triggerText = activeItem?.name ?? t("myViews");
  const triggerAria = activeItem
    ? `${t("myViews")}: ${activeItem.name}, ${activeChanged ? t("changed") : t("active")}`
    : t("myViewMenu");

  return (
    <>
      <DropdownMenu>
        <MyViewTrigger
          activeChanged={activeChanged}
          activeItem={activeItem}
          busy={Boolean(updatingId || dialogPending || deletePending)}
          disabled={!canSave}
          triggerAria={triggerAria}
          triggerRef={triggerRef}
          triggerText={triggerText}
        />
        <MyViewMenu
          actionError={actionError}
          activeChanged={activeChanged}
          activeItem={activeItem}
          canSave={canSave}
          items={scopedItems}
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
          data-testid="my-view-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => triggerRef.current?.focus());
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "save"
                ? t("saveViewTitle")
                : dialog?.kind === "rename"
                  ? t("renameViewTitle")
                  : t("duplicateViewTitle")}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "save"
                ? t("saveViewDescription")
                : t("viewNameDescription")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDialogSubmit}>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="my-view-name"
            >
              {t("viewNameLabel")}
              <input
                className="h-9 rounded-md border border-border bg-surface-page px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
                id="my-view-name"
                maxLength={80}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={t("viewNamePlaceholder")}
                ref={nameInputRef}
                value={draftName}
                aria-describedby={
                  dialogError ? "my-view-dialog-error" : undefined
                }
                aria-invalid={dialogError ? "true" : undefined}
                data-testid="my-view-name-input"
              />
            </label>
            {dialogError ? (
              <p
                className="mt-2 text-xs text-destructive-text"
                id="my-view-dialog-error"
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
                disabled={dialogPending || !canSave}
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
        <DialogContent data-testid="my-view-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t("deleteViewConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteViewConfirmDescription", {
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
              data-testid="my-view-confirm-delete"
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
