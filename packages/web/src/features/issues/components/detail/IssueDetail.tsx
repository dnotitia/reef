"use client";

import { Button } from "@/components/ui/button";
import { notifyUndoableSuccess } from "@/components/ui/toastFeedback";
import { useAskAiStore } from "@/features/ai/stores/useAskAiStore";
import { useArchiveIssue } from "@/features/issues/hooks/mutations/useArchiveIssue";
import { useDeleteIssue } from "@/features/issues/hooks/mutations/useDeleteIssue";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { useUploadIssueAttachment } from "@/features/issues/hooks/mutations/useUploadIssueAttachment";
import {
  type IssueDetailResponse,
  useIssue,
} from "@/features/issues/hooks/queries/useIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import { resolveIssueAttachmentUrl } from "@/features/issues/lib/attachmentUrls";
import type { ClosedReason, IssueUpdatePatch } from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { buildOpenIssueHref } from "../../lib/issueHref";
import { buildStatusPatch } from "../../lib/statusPatch";
import { CloseIssueDialog } from "./CloseIssueDialog";
import { DeleteIssueDialog } from "./DeleteIssueDialog";
import { IssueChromeActions } from "./IssueChromeActions";
import {
  type IssueDetailDraft,
  createIssueDetailDraft,
  issueDetailDraftReducer,
} from "./IssueDetailDraft";
import { IssueDetailMain } from "./IssueDetailMain";
import { IssueDetailSidebar } from "./IssueDetailSidebar";
import { IssueDetailSkeleton } from "./IssueDetailSkeleton";
import { useIssueAutosaveMachine } from "./useIssueAutosaveMachine";

interface IssueDetailProps {
  issueId: string;
  vault: string;
  onClose: () => void;
}

/**
 * Issue detail panel rendered inside the intercepting route Sheet.
 *
 * Editing is inline auto-save: local state mirrors the loaded
 * issue for responsive typing, and each field commits on its own natural edit
 * boundary — selects/labels/assignee on change, title/body on blur — through
 * the optimistic `useUpdateIssue` mutation. There is no Save button and no
 * dirty state to lose: dismissing the panel (X / Esc / outside click) keeps
 * whatever was already committed. A small header indicator reflects the
 * in-flight / saved / failed state. akb is LWW, so per-field writes are safe.
 */
export function IssueDetail({ issueId, vault, onClose }: IssueDetailProps) {
  const t = useTranslations("issues.detail");
  const c = useTranslations("common");
  const { data, isPending, isError, error, refetch } = useIssue(issueId, vault);
  // Whole-vault list, the relation inputs' option source. The parent breadcrumb
  // that also reads it now lives in the sheet's persistent chrome bar (REEF-286),
  // which owns its own `useIssueList` read for the crumb's loading skeleton
  // (REEF-283) — so the body no longer threads `allIssuesPending` through.
  const { data: allIssues = [] } = useIssueList(vault);
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault);

  // Skeleton / error render the body. The sheet's persistent chrome bar
  // owns the identity (id · status · type · breadcrumb) and Close in every state
  // (REEF-286), so these states carry neither a header nor a close button.
  if (isPending) {
    return <IssueDetailSkeleton />;
  }

  if (isError) {
    return (
      <div data-testid="issue-detail-error" className="p-6 flex flex-col gap-4">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : t("loadError")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {c("retry")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return <IssueDetailSkeleton />;
  }

  return (
    <IssueDetailLoaded
      key={`${vault}:${data.issue.id}`}
      issueId={issueId}
      vault={vault}
      data={data}
      allIssues={allIssues}
      relations={relations}
      onClose={onClose}
    />
  );
}

function IssueDetailLoaded({
  issueId,
  vault,
  data,
  allIssues,
  relations,
  onClose,
}: IssueDetailProps & {
  data: IssueDetailResponse;
  allIssues: ReturnType<typeof useIssueList>["data"];
  relations: ReturnType<typeof useIssueRelations>["data"];
}) {
  const t = useTranslations("toasts");
  const dt = useTranslations("issues.detail");
  const updateMutation = useUpdateIssue();
  const archiveMutation = useArchiveIssue();
  const deleteMutation = useDeleteIssue();
  const uploadAttachment = useUploadIssueAttachment();
  const serverDraft = useMemo(() => createIssueDetailDraft(data), [data]);
  const [draft, dispatchDraft] = useReducer(
    issueDetailDraftReducer,
    serverDraft,
  );
  const previousServerDraftRef = useRef(serverDraft);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const {
    commit: commitAutosave,
    retryFailedCommits,
    saveStatus,
    conflictCount,
  } = useIssueAutosaveMachine({
    issueId,
    vault,
    mutateIssue: updateMutation.mutateAsync,
  });
  const handledConflictRef = useRef(conflictCount);
  const issue = data.issue;
  const isArchived = issue.archived_at != null;
  const resolveBodyImageSrc = useMemo(
    () => (url: string) => resolveIssueAttachmentUrl({ issueId, vault, url }),
    [issueId, vault],
  );

  // "Ask AI about this issue" grounds the chat on this issue (REEF-360 AC3).
  // Grounding is set by this explicit affordance — not silently from the
  // sheet being open — so the context chip reflects a deliberate choice.
  const openAskAiWithIssue = useAskAiStore((s) => s.openWithIssue);

  useEffect(() => {
    // A save conflict (REEF-227): discard the rejected local edits and re-derive
    // from the server snapshot. The conflict refetch then lands a fresher
    // snapshot and the normal sync below pulls it in (the draft is now clean).
    // Done before the 3-way sync because that path keeps dirty fields — exactly
    // the conflicted field we should not preserve.
    if (conflictCount !== handledConflictRef.current) {
      handledConflictRef.current = conflictCount;
      dispatchDraft({ type: "reset", next: serverDraft });
      previousServerDraftRef.current = serverDraft;
      return;
    }
    if (saveStatus === "saving" || saveStatus === "error") return;
    const previous = previousServerDraftRef.current;
    dispatchDraft({ type: "sync", previous, next: serverDraft });
    previousServerDraftRef.current = serverDraft;
  }, [saveStatus, serverDraft, conflictCount]);

  function setDraftField<K extends keyof IssueDetailDraft>(
    field: K,
    value: IssueDetailDraft[K],
  ) {
    dispatchDraft({ type: "set", field, value });
  }

  function commit(patch: IssueUpdatePatch, content?: string) {
    commitAutosave(patch, content);
  }

  function commitTitle(value: string) {
    const trimmed = value.trim();
    // Empty/whitespace titles fail server validation. Revert to the saved
    // value instead of committing it.
    if (!trimmed) {
      setDraftField("title", issue.title);
      return;
    }
    if (trimmed !== issue.title) commit({ title: trimmed });
  }

  function commitBody(value: string) {
    if (value !== (data.content ?? "")) commit({}, value);
  }

  async function handleBodyUploadFiles(files: File[]) {
    return Promise.all(
      files.map((file) =>
        uploadAttachment.mutateAsync({
          issueId,
          vault,
          file,
          source: "issue_body",
          inline: file.type.startsWith("image/"),
        }),
      ),
    );
  }

  function commitTextField<K extends keyof IssueUpdatePatch>(
    key: K,
    value: string,
    previous: string | null | undefined,
  ) {
    const next = value.trim();
    if (next === (previous ?? "")) return;
    commit({ [key]: next.length > 0 ? next : null } as IssueUpdatePatch);
  }

  function commitSelectionField<K extends keyof IssueUpdatePatch>(
    key: K,
    value: string,
    previous: string | null | undefined,
  ) {
    if (value === (previous ?? "")) return;
    commit({ [key]: value || null } as IssueUpdatePatch);
  }

  function commitNumberField<K extends keyof IssueUpdatePatch>(
    key: K,
    value: string,
    previous: number | null | undefined,
  ) {
    const trimmed = value.trim();
    const next = trimmed.length > 0 ? Number(trimmed) : null;
    if (Number.isNaN(next)) {
      setDraftField("estimatePoints", previous == null ? "" : String(previous));
      return;
    }
    if (next === (previous ?? null)) return;
    commit({ [key]: next } as IssueUpdatePatch);
  }

  function confirmClose(reason: ClosedReason) {
    setDraftField("status", "closed");
    setCloseDialogOpen(false);
    commit(buildStatusPatch(issue, "closed", undefined, reason));
  }

  async function handleArchiveToggle() {
    const archiveToastId = `archive:${issueId}`;
    try {
      if (isArchived) {
        await archiveMutation.unarchive({ id: issueId, vault });
        // Symmetric inverse → offer Undo back to archived.
        notifyUndoableSuccess({
          id: archiveToastId,
          message: dt("unarchived", { id: issueId }),
          onUndo: () =>
            void archiveMutation
              .archive({ id: issueId, vault })
              .catch((err: unknown) =>
                toast.error(
                  err instanceof Error ? err.message : t("undoError"),
                ),
              ),
        });
      } else {
        await archiveMutation.archive({ id: issueId, vault });
        // Keep the panel open: the Undo action should stay mounted so its
        // unarchive (and its cache invalidation) run reliably. The archived
        // badge in the header already signals the new state.
        notifyUndoableSuccess({
          id: archiveToastId,
          message: dt("archived", { id: issueId }),
          onUndo: () =>
            void archiveMutation
              .unarchive({ id: issueId, vault })
              .catch((err: unknown) =>
                toast.error(
                  err instanceof Error ? err.message : t("undoError"),
                ),
              ),
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("archiveStateError"));
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ id: issueId, vault });
      toast.success(t("issueDeleted", { id: issueId }));
      setConfirmDeleteOpen(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteIssueError"));
    }
  }

  async function handleCopyLink() {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      toast.error(t("copyLinkError"));
      return;
    }
    // The canonical shareable deep link, rebuilt from vault + id rather than
    // read from window.location: opened from the list/board the address bar is
    // the intercept route (/issues/{id}?view=…), not this issue's own deep link,
    // and we do not want the ephemeral view query riding along in a shared URL.
    const url = `${window.location.origin}${buildOpenIssueHref(
      vault,
      issueId,
      new URLSearchParams(),
    )}`;
    try {
      await clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("copyLinkError"));
    }
  }

  return (
    <div data-testid="issue-detail" className="flex flex-col gap-5 p-6">
      {/* Identity (status · id · type · parent breadcrumb) now lives in the
          sheet's persistent chrome bar (REEF-286); the body owns the action
          cluster — save status + ⋮ — which IssueChromeActions portals up into
          that bar (and renders in-flow as a fallback when no bar is in scope,
          e.g. a standalone unit render). */}
      <IssueChromeActions
        updatedAt={issue.updated_at ?? null}
        saveStatus={saveStatus}
        onRetryLastCommit={retryFailedCommits}
        isArchived={isArchived}
        isArchivePending={archiveMutation.isPending}
        isDeletePending={deleteMutation.isPending}
        onCopyLink={() => void handleCopyLink()}
        onAskAi={() => {
          // Ground the chat on this issue, then close the full-height issue
          // sheet so the floating Ask AI panel (bottom-right) is not occluded by
          // it. The issue stays in the chat via the context chip + prefetch.
          openAskAiWithIssue(issueId);
          onClose();
        }}
        onArchiveToggle={() => void handleArchiveToggle()}
        onDeleteRequested={() => setConfirmDeleteOpen(true)}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <IssueDetailMain
          issueId={issueId}
          vault={vault}
          issue={issue}
          allIssues={allIssues ?? []}
          relations={relations}
          title={draft.title}
          body={draft.body}
          externalRefs={draft.externalRefs}
          implementationRefs={draft.implementationRefs}
          setTitle={(value) => setDraftField("title", value)}
          setBody={(value) => setDraftField("body", value)}
          setExternalRefs={(value) => setDraftField("externalRefs", value)}
          setImplementationRefs={(value) =>
            setDraftField("implementationRefs", value)
          }
          onUploadBodyFiles={handleBodyUploadFiles}
          resolveBodyImageSrc={resolveBodyImageSrc}
          commitTitle={commitTitle}
          commitBody={commitBody}
          commit={commit}
        />

        <IssueDetailSidebar
          vault={vault}
          issueId={issueId}
          issue={issue}
          allIssues={allIssues ?? []}
          relations={relations}
          issueType={draft.issueType}
          status={draft.status}
          priority={draft.priority}
          severity={draft.severity}
          labels={draft.labels}
          assignee={draft.assignee}
          requester={draft.requester}
          reporter={draft.reporter}
          startDate={draft.startDate}
          dueDate={draft.dueDate}
          sprintId={draft.sprintId}
          milestoneId={draft.milestoneId}
          releaseId={draft.releaseId}
          estimatePoints={draft.estimatePoints}
          parentId={draft.parentId}
          dependsOn={draft.dependsOn}
          blocks={draft.blocks}
          relatedTo={draft.relatedTo}
          setIssueType={(value) => setDraftField("issueType", value)}
          setStatus={(value) => setDraftField("status", value)}
          setPriority={(value) => setDraftField("priority", value)}
          setSeverity={(value) => setDraftField("severity", value)}
          setLabels={(value) => setDraftField("labels", value)}
          setAssignee={(value) => setDraftField("assignee", value)}
          setRequester={(value) => setDraftField("requester", value)}
          setReporter={(value) => setDraftField("reporter", value)}
          setStartDate={(value) => setDraftField("startDate", value)}
          setDueDate={(value) => setDraftField("dueDate", value)}
          setSprintId={(value) => setDraftField("sprintId", value)}
          setMilestoneId={(value) => setDraftField("milestoneId", value)}
          setReleaseId={(value) => setDraftField("releaseId", value)}
          setEstimatePoints={(value) => setDraftField("estimatePoints", value)}
          setParentId={(value) => setDraftField("parentId", value)}
          setDependsOn={(value) => setDraftField("dependsOn", value)}
          setBlocks={(value) => setDraftField("blocks", value)}
          setRelatedTo={(value) => setDraftField("relatedTo", value)}
          commit={commit}
          commitTextField={commitTextField}
          commitNumberField={commitNumberField}
          commitSelectionField={commitSelectionField}
          onClosedStatusRequested={() => setCloseDialogOpen(true)}
        />
      </div>

      <DeleteIssueDialog
        open={confirmDeleteOpen}
        issueId={issueId}
        isDeleting={deleteMutation.isPending}
        onOpenChange={setConfirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
      <CloseIssueDialog
        open={closeDialogOpen}
        issueId={issueId}
        disabled={updateMutation.isPending}
        onOpenChange={setCloseDialogOpen}
        onConfirm={confirmClose}
      />
    </div>
  );
}
