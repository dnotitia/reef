"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  assigneeRecentsQueryKey,
  rememberRecentAssigneeLogin,
} from "@/lib/storage/assigneeRecents";
import type { IssueDocument, IssueUpdatePatch } from "@reef/core";
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import {
  restoreIssueListCacheItems,
  updateIssueListCaches,
} from "../../lib/issueListCache";
import {
  listInvalidationPredicate,
  patchAffectsActivityTimeline,
  patchAffectsRelationGraph,
} from "../../lib/issueListMembership";
import { toListItem } from "../../lib/toListItem";
import { activityKey } from "../queries/useActivity";
import { issueBodyHistoryKey } from "../queries/useIssueBodyHistory";

export interface UpdateIssueInput {
  id: string;
  vault: string;
  patch: IssueUpdatePatch;
  content?: string;
}

export type UpdateIssueResult = IssueDocument;

const UPDATE_ISSUE_MUTATION_KEY = ["issues", "update"] as const;

export type IssueStatusUpdateState = {
  status: "idle" | "pending" | "success" | "error";
  error: Error | null;
  submittedAt: number;
};

export interface UpdateIssueRollbackContext {
  previousDetail?: UpdateIssueResult;
}

export interface UseUpdateIssueOptions {
  /** Bulk jobs defer list/relation reconciliation until their sequential queue finishes. */
  reconciliation?: "immediate" | "deferred";
  /**
   * Runs after the optimistic caches have been restored. Detail callers can use
   * the snapshot to reconcile local draft state without changing retry/error
   * handling for the mutation itself.
   */
  onError?: (
    error: Error,
    input: UpdateIssueInput,
    context: UpdateIssueRollbackContext | undefined,
  ) => void;
}

interface UpdateIssueMutationContext extends UpdateIssueRollbackContext {
  previousLists?: Array<[QueryKey, unknown]>;
}

function isStatusUpdateInput(value: unknown): value is UpdateIssueInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    id?: unknown;
    vault?: unknown;
    patch?: unknown;
  };
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.vault !== "string" ||
    !candidate.patch ||
    typeof candidate.patch !== "object" ||
    Array.isArray(candidate.patch)
  ) {
    return false;
  }
  return typeof (candidate.patch as { status?: unknown }).status === "string";
}

function matchesStatusUpdate(
  value: unknown,
  vault: string,
  issueId: string,
): value is UpdateIssueInput {
  return (
    isStatusUpdateInput(value) && value.vault === vault && value.id === issueId
  );
}

export function hasPendingIssueStatusUpdate(
  queryClient: QueryClient,
  vault: string,
  issueId: string,
): boolean {
  return (
    queryClient.isMutating({
      mutationKey: UPDATE_ISSUE_MUTATION_KEY,
      predicate: (mutation) =>
        mutation.state.status === "pending" &&
        matchesStatusUpdate(mutation.state.variables, vault, issueId),
    }) > 0
  );
}

export function useIssueStatusUpdateState(
  vault: string,
  issueId: string,
): IssueStatusUpdateState {
  const states = useMutationState({
    filters: {
      mutationKey: UPDATE_ISSUE_MUTATION_KEY,
      predicate: (mutation) =>
        matchesStatusUpdate(mutation.state.variables, vault, issueId),
    },
    select: (mutation) => ({
      status: mutation.state.status,
      error:
        mutation.state.error instanceof Error ? mutation.state.error : null,
      submittedAt: mutation.state.submittedAt,
    }),
  });
  const latest = states.reduce<IssueStatusUpdateState | undefined>(
    (current, candidate) =>
      current === undefined || candidate.submittedAt >= current.submittedAt
        ? candidate
        : current,
    undefined,
  );
  return (
    latest ?? {
      status: "idle",
      error: null,
      submittedAt: 0,
    }
  );
}

/**
 * Update an issue in the active akb vault. The affected list/detail caches are
 * patched optimistically so board moves feel immediate, then overwritten with
 * the server response on success, avoiding blanket invalidation (REEF-098). The
 * caches stay the fresh server truth in place, and membership/order or
 * relation-graph changes trigger a narrow refetch (see `issueListMembership`).
 *
 * Row-scalar edits (status, priority, dates, ...) stay last-write-wins,
 * merged server-side per field. Document-projected edits (body/title/labels/
 * relations) carry the cached `commit_hash` as akb's `expected_commit`
 * precondition (REEF-227): a concurrent external edit is rejected with a 409
 * instead of silently overwritten. On that 409 the detail is refetched so the
 * editor reconciles to the latest, and the autosave machine surfaces the
 * conflict as a non-retry notice (not a blind retry of the stale edit), so the
 * change that won is not clobbered; the user re-applies against the refreshed
 * form.
 */
export function useUpdateIssue(options: UseUpdateIssueOptions = {}) {
  const queryClient = useQueryClient();
  const currentLogin = useCurrentUserLogin();
  const reconciliation = options.reconciliation ?? "immediate";

  return useMutation<
    UpdateIssueResult,
    Error,
    UpdateIssueInput,
    UpdateIssueMutationContext
  >({
    mutationKey: UPDATE_ISSUE_MUTATION_KEY,
    mutationFn: async ({
      id,
      vault,
      patch,
      content,
    }: UpdateIssueInput): Promise<UpdateIssueResult> => {
      // OCC base (REEF-227): the document commit the open editor is showing,
      // read from the detail cache — the form's own render source. In a stale
      // window (the cache has not refetched after an external edit) this is the
      // stale base, so akb rejects the write rather than overwriting. Sequential
      // autosaves stay self-consistent: onSuccess advances the cached commit
      // before the next commit's mutationFn reads it. Omitted when absent so the
      // edit degrades to last-write-wins.
      const baseCommit = queryClient.getQueryData<UpdateIssueResult>([
        "issues",
        "detail",
        vault,
        id,
      ])?.commit_hash;
      const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          update: {
            issue_id: id,
            patch,
            ...(content !== undefined ? { content } : {}),
            ...(baseCommit ? { expected_commit: baseCommit } : {}),
          },
        }),
      });
      if (!res.ok) {
        await throwHttpError(res, `Update failed: ${res.status}`);
      }
      return res.json() as Promise<UpdateIssueResult>;
    },
    onMutate: async ({ id, vault, patch, content }) => {
      const listKey = ["issues", "list", vault] as const;
      const detailKey = ["issues", "detail", vault, id] as const;

      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);

      // Snapshot + optimistically update every list cache for the vault — the
      // unfiltered list and any server-filtered/sorted
      // `['issues','list',vault,<query>]` variant — so the change is immediate
      // in whichever view is visible.
      const previousLists = updateIssueListCaches(
        queryClient,
        vault,
        (issue) =>
          issue.id === id ? toListItem({ ...issue, ...patch }) : issue,
      );
      const previousDetail =
        queryClient.getQueryData<UpdateIssueResult>(detailKey);

      // Spread `current` so `commit_hash` (the OCC base) survives the optimistic
      // patch — mutationFn reads it back as expected_commit (REEF-227).
      queryClient.setQueryData<UpdateIssueResult>(detailKey, (current) =>
        current
          ? {
              ...current,
              issue: { ...current.issue, ...patch },
              content: content ?? current.content,
            }
          : current,
      );

      return { previousDetail, previousLists };
    },
    onError: (err, { id, vault, ...input }, context) => {
      if (context?.previousLists) {
        restoreIssueListCacheItems(queryClient, context.previousLists, id);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ["issues", "detail", vault, id],
          context.previousDetail,
        );
      }
      // Save conflict (REEF-227 document OCC): the cached commit the form held
      // was stale. Refetch the detail so the editor re-reads the latest body +
      // commit and the 3-way form sync pulls in the external change. The autosave
      // machine surfaces this 409 as a non-retry notice (not a blind retry of the
      // stale edit), so the change that won is not silently clobbered; the user
      // re-applies against the refreshed form. Fires on 409 — a rare
      // exceptional path — so it does not reintroduce the post-success
      // invalidation REEF-097/098 removed.
      if ((err as { status?: number }).status === 409) {
        void queryClient.invalidateQueries({
          queryKey: ["issues", "detail", vault, id],
        });
      }
      options.onError?.(
        err,
        { id, vault, ...input },
        context ? { previousDetail: context.previousDetail } : undefined,
      );
    },
    onSuccess: async (data, { id, vault, patch, content }) => {
      const item = toListItem(data.issue);
      // The server response is authoritative — write it straight into the
      // detail and every list-variant cache (ref-preserving for unchanged
      // rows). This keeps the whole-set consumers (board, backlog, reports,
      // timeline, search) fresh with no re-request, and the entity-store
      // normalizer mirrors the patched item into the store so the migrated
      // list rows update granularly.
      queryClient.setQueryData(["issues", "detail", vault, id], data);
      updateIssueListCaches(queryClient, vault, (issue) =>
        issue.id === id ? item : issue,
      );

      // Avoid blanket invalidation (REEF-098). The in-place patch above supplies
      // server-backed values for list variants; a refetch is reserved for where
      // an edit changes *which* list the issue is in, *where* it sorts, or a
      // free-text match set. One order-aware predicate handles both a membership
      // edit and a non-membership content edit (REEF-323/REEF-325): e.g. a
      // priority edit reorders priority-sorted variants, and a title/due-date
      // edit reorders `updated_at`-sorted variants (every edit restamps
      // `updated_at`) and variants sorted by the edited field — while an
      // unrelated assignee-filtered variant stays patched in place.
      if (reconciliation === "immediate") {
        void queryClient.invalidateQueries({
          queryKey: ["issues", "list", vault],
          predicate: listInvalidationPredicate(patch),
        });
        if (patchAffectsRelationGraph(patch)) {
          void queryClient.invalidateQueries({
            queryKey: ["issues", "relations", vault],
          });
        }
      }
      // A logged field edit appends a `reef_activity` event server-side
      // (best-effort): status_change (REEF-063) and the field-change set
      // `diffFieldActivityEvents` records — assignee / priority / planning /
      // impl refs (REEF-126), title / due / estimate / parent / archive /
      // labels / relations (REEF-277), and issue type / start date. Refetch the
      // issue's activity query so the freshly logged event appears immediately,
      // instead of waiting for the stale window (REEF-064).
      if (patchAffectsActivityTimeline(patch)) {
        void queryClient.invalidateQueries({
          queryKey: activityKey(vault, id),
        });
      }
      if (content !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: issueBodyHistoryKey(vault, id),
        });
      }

      const assignedLogin =
        typeof patch.assigned_to === "string" ? patch.assigned_to.trim() : "";
      if (currentLogin && assignedLogin) {
        try {
          const recentLogins = await rememberRecentAssigneeLogin(
            currentLogin,
            vault,
            assignedLogin,
          );
          queryClient.setQueryData(
            assigneeRecentsQueryKey(currentLogin, vault),
            recentLogins,
          );
        } catch {
          // Browser storage failure does not turn a successful issue save into
          // an error or claim that the login was added to recents.
        }
      }
    },
  });
}
