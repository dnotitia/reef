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
import { useWorkspaceAccess } from "@/features/settings/hooks/useWorkspaceAccess";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useHydrated } from "@/lib/useHydrated";
import {
  usePlanningKindLabels,
  usePlanningKindSingularLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { LayoutDashboard, List as ListIcon, Plus } from "lucide-react";
import type { Sprint, SprintRolloverResume } from "@reef/core";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
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
import { SprintRolloverDialog } from "./SprintRolloverDialog";
import { SprintRolloverNudge } from "./SprintRolloverNudge";
import { SprintRolloverResumeNotice } from "./SprintRolloverResumeNotice";
import type { IssueAggregationState } from "./PlanningRollup";
import {
  type EditorState,
  PLANNING_KINDS,
  buildPlanningInput,
  emptyItem,
  mergeEditorItem,
  readPlanningView,
  type PlanningView,
} from "./planningPageUtils";
import { selectActiveSprint } from "../lib/planningItems";
import { PlanningOverview } from "./PlanningOverview";

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

function planningHref(vault: string, params: URLSearchParams): string {
  const query = params.toString();
  return withVault(vault, query ? `/planning?${query}` : "/planning");
}

function PlanningViewSwitcher({
  view,
  onSelect,
}: {
  view: PlanningView;
  onSelect: (view: PlanningView) => void;
}) {
  const t = useTranslations("planning");
  const options = [
    {
      view: "overview" as const,
      Icon: LayoutDashboard,
      label: t("view.overview"),
    },
    { view: "list" as const, Icon: ListIcon, label: t("view.list") },
  ];

  return (
    <div
      role="group"
      aria-label={t("planningView")}
      data-testid="planning-view-switcher"
      className={SEGMENTED_CONTROL_TRACK}
    >
      {options.map(({ view: option, Icon, label }) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          aria-label={label}
          title={label}
          data-testid={`planning-view-${option}`}
          onClick={() => onSelect(option)}
          className={cn(
            SEGMENTED_CONTROL_ITEM,
            "whitespace-nowrap",
            view === option
              ? SEGMENTED_CONTROL_ITEM_ACTIVE
              : SEGMENTED_CONTROL_ITEM_INACTIVE,
          )}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function PlanningPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const router = useRouter();
  const searchParams = useSearchParams();
  const planningView = readPlanningView(searchParams);
  const activeKind = readPlanningKind(searchParams.get("kind"));
  const createKind =
    planningView === "list" ? activeKind : DEFAULT_PLANNING_KIND;
  const expandedId = searchParams.get("detail");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const editorFocusOriginRef = useRef<HTMLElement | null>(null);
  const deleteFocusOriginRef = useRef<HTMLElement | null>(null);
  const catalogQuery = usePlanningCatalog(vault);
  const issueQuery = useIssueList(vault);
  const createMutation = useCreatePlanningItem(vault);
  const updateMutation = useUpdatePlanningItem(vault);
  const deleteMutation = useDeletePlanningItem(vault);
  const access = useWorkspaceAccess(vault);
  const hydrated = useHydrated();
  const [rolloverSource, setRolloverSource] = useState<Sprint | null>(null);
  const [rolloverResume, setRolloverResume] =
    useState<SprintRolloverResume | null>(null);

  const catalog = catalogQuery.data;
  const issues = issueQuery.data;
  const issueAggregationState: IssueAggregationState = issueQuery.isError
    ? "unavailable"
    : issueQuery.isPending || !issues
      ? "loading"
      : "available";
  const rolloverIssueState = issueQuery.isError
    ? "error"
    : issueQuery.isPending || !issues
      ? "loading"
      : "available";
  const activeSprint = selectActiveSprint(catalog?.sprints ?? []);
  const rolloverResumes = catalog?.rollover_resumes ?? [];

  const openRollover = useCallback((sprint: Sprint) => {
    setRolloverResume(null);
    setRolloverSource(sprint);
  }, []);
  const openRolloverResume = useCallback((resume: SprintRolloverResume) => {
    setRolloverResume(resume);
    setRolloverSource(resume.result.source_sprint);
  }, []);

  // Kind copy resolves in the active locale (REEF-292); captured here so the
  // toast handlers and the kind tabs below all read the same maps.
  const planningKindLabels = usePlanningKindLabels();
  const planningKindSingular = usePlanningKindSingularLabels();
  const t = useTranslations("toasts");
  const tp = useTranslations("planning");
  const nav = useTranslations("nav");

  const selectKind = useCallback(
    (kind: PlanningKind) => {
      if (kind === activeKind) return;
      const next = new URLSearchParams(searchParams);
      next.set("view", "list");
      next.set("kind", kind);
      next.delete("detail");
      router.push(planningHref(vault, next), { scroll: false });
    },
    [activeKind, router, searchParams, vault],
  );

  const selectView = useCallback(
    (view: PlanningView) => {
      if (view === planningView) return;
      const next = new URLSearchParams(searchParams);
      next.set("view", view);
      if (view === "overview") {
        next.delete("kind");
        next.delete("detail");
      } else {
        next.delete("detail");
      }
      router.push(planningHref(vault, next), { scroll: false });
    },
    [planningView, router, searchParams, vault],
  );

  const setExpandedId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) {
        next.set("detail", id);
      } else {
        next.delete("detail");
      }
      router.replace(planningHref(vault, next), { scroll: false });
    },
    [router, searchParams, vault],
  );

  function startCreate(kind: PlanningKind) {
    captureEditorFocusOrigin();
    setFormError(null);
    setEditor({ mode: "create", kind, item: emptyItem(kind) });
  }

  function startEdit(kind: PlanningKind, item: PlanningItem) {
    captureEditorFocusOrigin();
    setFormError(null);
    setEditor({ mode: "edit", kind, item: { ...item } });
  }

  function startDelete(kind: PlanningKind, item: PlanningItem) {
    const active = document.activeElement;
    deleteFocusOriginRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setDeleteTarget({ kind, item });
  }

  function captureEditorFocusOrigin() {
    const active = document.activeElement;
    editorFocusOriginRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }

  function closeEditor() {
    setEditor(null);
    setFormError(null);
  }

  async function saveEditor() {
    if (!editor || !vault) return;
    const input = buildPlanningInput(editor.kind, editor.item);
    if (!input.name.trim()) {
      setFormError(tp("nameRequired"));
      return;
    }

    setFormError(null);
    try {
      if (editor.mode === "create") {
        await createMutation.mutateAsync({ kind: editor.kind, item: input });
      } else {
        const item = { ...input, id: String(editor.item.id) } as PlanningItem;
        await updateMutation.mutateAsync({ kind: editor.kind, item });
      }
      closeEditor();
    } catch {
      const message = t("planningSaveError");
      setFormError(message);
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
      toast.success(
        t("planningDeleted", { kind: planningKindSingular[target.kind] }),
      );
      // A successful delete removes the invoking row, so do not ask Radix to
      // restore focus to a detached action. Cancellation/close keeps this ref
      // intact for PlanningDeleteDialog's close-autofocus handler.
      deleteFocusOriginRef.current = null;
      setDeleteTarget(null);
    } catch {
      toast.error(t("planningDeleteError"));
    }
  }

  if (!vault && !vaultLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={nav("planning")} />
        <EmptyWorkspaceNotice />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={nav("planning")}
        description={vault || undefined}
        titleAdjacent={
          <PlanningViewSwitcher view={planningView} onSelect={selectView} />
        }
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => startCreate(createKind)}
            disabled={!vault}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {tp("newKind", {
              kind: planningKindSingular[createKind].toLowerCase(),
            })}
          </Button>
        }
      />
      <PageBody pad="compact">
        {planningView === "list" ? (
          <div
            role="group"
            aria-label={tp("planningKind")}
            className={cn("mb-4", SEGMENTED_CONTROL_TRACK)}
            data-testid="planning-kind-switcher"
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
                  data-testid={`planning-kind-${kind}`}
                  onClick={() => selectKind(kind)}
                >
                  <PlanningKindIcon kind={kind} decorative size={14} />
                  {planningKindLabels[kind]}
                </button>
              );
            })}
          </div>
        ) : null}
        {rolloverSource === null ? (
          <SprintRolloverResumeNotice
            resumes={rolloverResumes}
            canEdit={access.canEditWorkspace}
            onOpen={openRolloverResume}
          />
        ) : null}
        <SprintRolloverNudge
          sprint={activeSprint}
          issues={issues}
          issueState={rolloverIssueState}
          now={hydrated ? Date.now() : null}
          canEdit={access.canEditWorkspace}
          priority={rolloverResumes.length > 0 ? "secondary" : "primary"}
          onOpen={openRollover}
        />

        {planningView === "overview" ? (
          <PlanningOverview
            catalog={catalog}
            vault={vault}
            issues={issues}
            isLoading={catalogQuery.isPending}
            isCatalogError={catalogQuery.isError}
            isCatalogFetching={catalogQuery.isFetching}
            onRetryCatalog={() => void catalogQuery.refetch()}
            issueAggregationState={issueAggregationState}
            isIssueFetching={issueQuery.isFetching}
            onRetryIssues={() => void issueQuery.refetch()}
            now={hydrated ? Date.now() : null}
          />
        ) : (
          <PlanningTable
            catalog={catalog}
            vault={vault}
            kind={activeKind}
            issues={issues}
            isLoading={catalogQuery.isPending}
            isCatalogError={catalogQuery.isError}
            isCatalogFetching={catalogQuery.isFetching}
            onRetryCatalog={() => void catalogQuery.refetch()}
            issueAggregationState={issueAggregationState}
            isIssueFetching={issueQuery.isFetching}
            onRetryIssues={() => void issueQuery.refetch()}
            expandedId={expandedId}
            onEdit={startEdit}
            onExpandedIdChange={setExpandedId}
            onRequestDelete={startDelete}
            onRequestRollover={openRollover}
            canEditRollover={access.canEditWorkspace}
            rolloverDisabledReason={undefined}
            deletingId={
              deleteMutation.isPending &&
              deleteMutation.variables?.kind === activeKind
                ? deleteMutation.variables.id
                : undefined
            }
          />
        )}
      </PageBody>

      <PlanningEditorDialog
        editor={editor}
        focusOriginRef={editorFocusOriginRef}
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
        focusOriginRef={deleteFocusOriginRef}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      <SprintRolloverDialog
        open={rolloverSource !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRolloverSource(null);
            setRolloverResume(null);
          }
        }}
        vault={vault}
        source={rolloverSource}
        resume={rolloverResume}
        catalog={catalog}
        issues={issues}
        issueState={rolloverIssueState}
        now={hydrated ? Date.now() : null}
        canEdit={access.canEditWorkspace}
        onRetryIssues={() => void issueQuery.refetch()}
      />
    </div>
  );
}
