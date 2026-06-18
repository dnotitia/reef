"use client";

import { Button } from "@/components/ui/button";
import { notifyUndoableSuccess } from "@/components/ui/toastFeedback";
import { useArchiveIssue } from "@/features/issues/hooks/mutations/useArchiveIssue";
import { useDeleteIssue } from "@/features/issues/hooks/mutations/useDeleteIssue";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import {
  type IssueDetailResponse,
  useIssue,
} from "@/features/issues/hooks/queries/useIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import type { ClosedReason, IssueUpdatePatch } from "@reef/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { buildStatusPatch } from "../../lib/statusPatch";
import { CloseIssueDialog } from "./CloseIssueDialog";
import { DeleteIssueDialog } from "./DeleteIssueDialog";
import { IssueDetailCloseButton } from "./IssueDetailCloseButton";
import {
  type IssueDetailDraft,
  createIssueDetailDraft,
  issueDetailDraftReducer,
} from "./IssueDetailDraft";
import { IssueDetailHeader } from "./IssueDetailHeader";
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
  const { data, isPending, isError, error, refetch } = useIssue(issueId, vault);
  const { data: allIssues = [] } = useIssueList(vault);
  // Whole-vault relation graph for accurate blocked badges in the relation dropdowns.
  const { data: relations } = useIssueRelations(vault);

  // The skeleton and error states render no IssueDetailHeader, so they supply
  // their own top-right close button to keep the sheet dismissable (REEF-111).
  if (isPending) {
    return (
      <>
        <IssueDetailCloseButton
          onClose={onClose}
          className="absolute top-4 right-4 z-10"
        />
        <IssueDetailSkeleton />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <IssueDetailCloseButton
          onClose={onClose}
          className="absolute top-4 right-4 z-10"
        />
        <div
          data-testid="issue-detail-error"
          className="p-6 flex flex-col gap-4"
        >
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load issue."}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <IssueDetailCloseButton
          onClose={onClose}
          className="absolute top-4 right-4 z-10"
        />
        <IssueDetailSkeleton />
      </>
    );
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
  const updateMutation = useUpdateIssue();
  const archiveMutation = useArchiveIssue();
  const deleteMutation = useDeleteIssue();
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
          message: `${issueId} unarchived`,
          onUndo: () =>
            void archiveMutation
              .archive({ id: issueId, vault })
              .catch((err: unknown) =>
                toast.error(
                  err instanceof Error ? err.message : "Failed to undo.",
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
          message: `${issueId} archived`,
          onUndo: () =>
            void archiveMutation
              .unarchive({ id: issueId, vault })
              .catch((err: unknown) =>
                toast.error(
                  err instanceof Error ? err.message : "Failed to undo.",
                ),
              ),
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change archive state.",
      );
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ id: issueId, vault });
      toast.success(`${issueId} deleted`);
      setConfirmDeleteOpen(false);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete issue.",
      );
    }
  }

  return (
    <div data-testid="issue-detail" className="flex flex-col gap-5 p-6">
      <IssueDetailHeader
        issueId={issueId}
        issueType={draft.issueType}
        status={draft.status}
        isArchived={isArchived}
        saveStatus={saveStatus}
        onRetryLastCommit={retryFailedCommits}
        updatedAt={issue.updated_at ?? null}
        isArchivePending={archiveMutation.isPending}
        isDeletePending={deleteMutation.isPending}
        onArchiveToggle={() => void handleArchiveToggle()}
        onDeleteRequested={() => setConfirmDeleteOpen(true)}
        onClose={onClose}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <IssueDetailMain
          issueId={issueId}
          vault={vault}
          issue={issue}
          allIssues={allIssues ?? []}
          relations={relations}
          title={draft.title}
          body={draft.body}
          parentId={draft.parentId}
          dependsOn={draft.dependsOn}
          blocks={draft.blocks}
          relatedTo={draft.relatedTo}
          externalRefs={draft.externalRefs}
          implementationRefs={draft.implementationRefs}
          setTitle={(value) => setDraftField("title", value)}
          setBody={(value) => setDraftField("body", value)}
          setParentId={(value) => setDraftField("parentId", value)}
          setDependsOn={(value) => setDraftField("dependsOn", value)}
          setBlocks={(value) => setDraftField("blocks", value)}
          setRelatedTo={(value) => setDraftField("relatedTo", value)}
          setExternalRefs={(value) => setDraftField("externalRefs", value)}
          setImplementationRefs={(value) =>
            setDraftField("implementationRefs", value)
          }
          commitTitle={commitTitle}
          commitBody={commitBody}
          commit={commit}
        />

        <IssueDetailSidebar
          vault={vault}
          issue={issue}
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
