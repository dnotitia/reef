"use client";

import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { Button } from "@/components/ui/button";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import {
  usePlanningKindLabels,
  usePlanningKindSingularLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  type PlanningItem,
  type PlanningKind,
  useCreatePlanningItem,
  useDeletePlanningItem,
  usePlanningCatalog,
  useUpdatePlanningItem,
} from "../hooks/usePlanningCatalog";
import { PlanningDeleteDialog } from "./PlanningDeleteDialog";
import { PlanningEditorDialog } from "./PlanningEditorDialog";
import { PlanningTable } from "./PlanningTable";
import {
  type EditorState,
  PLANNING_KINDS,
  buildPlanningInput,
  emptyItem,
  mergeEditorItem,
} from "./planningPageUtils";

const DEFAULT_PLANNING_KIND: PlanningKind = "sprints";

type DeleteTarget = {
  kind: PlanningKind;
  item: PlanningItem;
};

function readPlanningKind(value: string | null): PlanningKind {
  return PLANNING_KINDS.includes(value as PlanningKind)
    ? (value as PlanningKind)
    : DEFAULT_PLANNING_KIND;
}

function planningHref(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/planning?${query}` : "/planning";
}

export function PlanningPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeKind = readPlanningKind(searchParams.get("kind"));
  const expandedId = searchParams.get("detail");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const catalogQuery = usePlanningCatalog(vault);
  const issueQuery = useIssueList(vault);
  const createMutation = useCreatePlanningItem(vault);
  const updateMutation = useUpdatePlanningItem(vault);
  const deleteMutation = useDeletePlanningItem(vault);

  const catalog = catalogQuery.data;
  const issues = issueQuery.data ?? [];

  // Kind copy resolves in the active locale (REEF-292); captured here so the
  // toast handlers and the kind tabs below all read the same maps.
  const planningKindLabels = usePlanningKindLabels();
  const planningKindSingular = usePlanningKindSingularLabels();

  const selectKind = useCallback(
    (kind: PlanningKind) => {
      if (kind === activeKind) return;
      const next = new URLSearchParams(searchParams);
      next.set("kind", kind);
      next.delete("detail");
      router.push(planningHref(next), { scroll: false });
    },
    [activeKind, router, searchParams],
  );

  const setExpandedId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) {
        next.set("detail", id);
      } else {
        next.delete("detail");
      }
      router.replace(planningHref(next), { scroll: false });
    },
    [router, searchParams],
  );

  function startCreate(kind: PlanningKind) {
    setFormError(null);
    setEditor({ mode: "create", kind, item: emptyItem(kind) });
  }

  function startEdit(kind: PlanningKind, item: PlanningItem) {
    setFormError(null);
    setEditor({ mode: "edit", kind, item: { ...item } });
  }

  function closeEditor() {
    setEditor(null);
    setFormError(null);
  }

  async function saveEditor() {
    if (!editor || !vault) return;
    const input = buildPlanningInput(editor.kind, editor.item);
    if (!input.name.trim()) {
      setFormError("Name is required.");
      return;
    }

    setFormError(null);
    try {
      if (editor.mode === "create") {
        await createMutation.mutateAsync({ kind: editor.kind, item: input });
        toast.success(`${planningKindSingular[editor.kind]} created.`);
      } else {
        const item = { ...input, id: String(editor.item.id) } as PlanningItem;
        await updateMutation.mutateAsync({ kind: editor.kind, item });
        toast.success(`${planningKindSingular[editor.kind]} saved.`);
      }
      closeEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed.";
      setFormError(message);
      toast.error(message);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteMutation.mutateAsync({
        kind: target.kind,
        id: target.item.id,
      });
      toast.success(`${planningKindSingular[target.kind]} deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  if (!vault && !vaultLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Planning" />
        <EmptyWorkspaceNotice />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Planning"
        description={vault || undefined}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => startCreate(activeKind)}
            disabled={!vault}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New {planningKindSingular[activeKind].toLowerCase()}
          </Button>
        }
      />
      <PageBody pad="compact">
        {/* biome-ignore lint/a11y/useSemanticElements: a header toggle group is not a form <fieldset>; role="group" + aria-label matches ViewSwitcher. */}
        <div
          role="group"
          aria-label="Planning kind"
          className={cn("mb-4", SEGMENTED_CONTROL_TRACK)}
        >
          {PLANNING_KINDS.map((kind) => {
            const isActive = activeKind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={isActive}
                className={cn(
                  SEGMENTED_CONTROL_ITEM,
                  isActive
                    ? SEGMENTED_CONTROL_ITEM_ACTIVE
                    : SEGMENTED_CONTROL_ITEM_INACTIVE,
                )}
                onClick={() => selectKind(kind)}
              >
                <PlanningKindIcon kind={kind} decorative size={14} />
                {planningKindLabels[kind]}
              </button>
            );
          })}
        </div>

        <PlanningTable
          catalog={catalog}
          kind={activeKind}
          issues={issues}
          isLoading={catalogQuery.isPending}
          expandedId={expandedId}
          onCreate={() => startCreate(activeKind)}
          onEdit={startEdit}
          onExpandedIdChange={setExpandedId}
          onRequestDelete={(kind, item) => setDeleteTarget({ kind, item })}
          deletingId={
            deleteMutation.isPending &&
            deleteMutation.variables?.kind === activeKind
              ? deleteMutation.variables.id
              : undefined
          }
        />
      </PageBody>

      <PlanningEditorDialog
        editor={editor}
        formError={formError}
        onClose={closeEditor}
        onChange={(patch) => {
          setFormError(null);
          setEditor((current) =>
            current
              ? { ...current, item: mergeEditorItem(current.item, patch) }
              : current,
          );
        }}
        onSave={() => void saveEditor()}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      <PlanningDeleteDialog
        target={deleteTarget?.item ?? null}
        kindSingular={
          deleteTarget
            ? planningKindSingular[deleteTarget.kind]
            : planningKindSingular[activeKind]
        }
        isDeleting={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
