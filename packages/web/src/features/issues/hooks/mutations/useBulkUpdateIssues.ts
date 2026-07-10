"use client";

import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import {
  type BulkIssueOperation,
  buildBulkIssuePatch,
  fallbackPatchForBulkOperation,
} from "@/features/issues/lib/bulkIssueUpdate";
import {
  listInvalidationPredicate,
  patchAffectsRelationGraph,
} from "@/features/issues/lib/issueListMembership";
import { getIssueEntity } from "@/features/issues/stores/issueEntityStore";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import type { IssueUpdatePatch } from "@reef/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export type BulkFailureReason = "not_found" | "conflict" | "request_failed";

export interface BulkIssueFailure {
  id: string;
  title: string;
  reason: BulkFailureReason;
  operation: BulkIssueOperation;
}

export interface BulkIssueRunResult {
  total: number;
  succeeded: string[];
  unchanged: string[];
  failures: BulkIssueFailure[];
}

interface BulkIssueProgress {
  running: boolean;
  processed: number;
  total: number;
  failures: BulkIssueFailure[];
}

const INITIAL_PROGRESS: BulkIssueProgress = {
  running: false,
  processed: 0,
  total: 0,
  failures: [],
};

function failureReason(error: unknown): BulkFailureReason {
  const status = (error as { status?: number }).status;
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "request_failed";
}

export function useBulkUpdateIssues(vault: string) {
  const mutation = useUpdateIssue({ reconciliation: "deferred" });
  const queryClient = useQueryClient();
  const runningRef = useRef(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);

  const run = useCallback(
    async (
      issueIds: readonly string[],
      operation: BulkIssueOperation,
      retainedFailures: readonly BulkIssueFailure[] = [],
    ): Promise<BulkIssueRunResult> => {
      if (runningRef.current) {
        return { total: 0, succeeded: [], unchanged: [], failures: [] };
      }

      const targetIds = [...issueIds];
      runningRef.current = true;
      useIssueSelectionStore.getState().setRunning(true);
      setProgress({
        running: true,
        processed: 0,
        total: targetIds.length,
        failures: [...retainedFailures],
      });

      const result: BulkIssueRunResult = {
        total: targetIds.length,
        succeeded: [],
        unchanged: [],
        failures: [],
      };
      const changedKeys = new Set<keyof IssueUpdatePatch>();

      try {
        for (const [index, id] of targetIds.entries()) {
          const issue = getIssueEntity(vault, id);
          const patch = issue
            ? buildBulkIssuePatch(issue, operation)
            : fallbackPatchForBulkOperation(operation);

          if (patch === null) {
            result.unchanged.push(id);
          } else {
            try {
              await mutation.mutateAsync({ id, vault, patch });
              result.succeeded.push(id);
              for (const key of Object.keys(
                patch,
              ) as (keyof IssueUpdatePatch)[]) {
                changedKeys.add(key);
              }
            } catch (error) {
              result.failures.push({
                id,
                title: issue?.title ?? id,
                reason: failureReason(error),
                operation,
              });
            }
          }

          setProgress({
            running: true,
            processed: index + 1,
            total: targetIds.length,
            failures: [...retainedFailures, ...result.failures],
          });
        }

        if (changedKeys.size > 0) {
          const combinedPatch = Object.fromEntries(
            [...changedKeys].map((key) => [key, null]),
          ) as IssueUpdatePatch;
          await queryClient.invalidateQueries({
            queryKey: ["issues", "list", vault],
            predicate: listInvalidationPredicate(combinedPatch),
          });
          if (patchAffectsRelationGraph(combinedPatch)) {
            await queryClient.invalidateQueries({
              queryKey: ["issues", "relations", vault],
            });
          }
        }

        useIssueSelectionStore
          .getState()
          .removeSucceeded([...result.succeeded, ...result.unchanged]);
        return result;
      } finally {
        runningRef.current = false;
        useIssueSelectionStore.getState().setRunning(false);
        setProgress((current) => ({
          ...current,
          running: false,
          failures: [...retainedFailures, ...result.failures],
        }));
      }
    },
    [mutation, queryClient, vault],
  );

  const retry = useCallback(
    (failure: BulkIssueFailure) =>
      run(
        [failure.id],
        failure.operation,
        progress.failures.filter((item) => item.id !== failure.id),
      ),
    [progress.failures, run],
  );

  const reset = useCallback(() => setProgress(INITIAL_PROGRESS), []);

  return { ...progress, run, retry, reset };
}
