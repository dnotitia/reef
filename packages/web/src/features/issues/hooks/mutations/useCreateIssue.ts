"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type {
  IssueCreateInput,
  IssueListItem,
  IssueMetadata,
} from "@reef/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toListItem } from "../../lib/toListItem";
import { upsertIssue } from "../../stores/issueEntityStore";

interface CreateIssueInput {
  /** akb vault name (active workspace). */
  vault: string;
  /** Project prefix from the vault's `_reef/config` doc (e.g., "REEF"). */
  prefix: string;
  create: IssueCreateInput;
  /**
   * akb document URIs to link as `references` relation edges once the issue is
   * created (REEF-083 AC4). Linked server-side post-write since the id is
   * server-allocated.
   */
  references?: string[];
}

interface CreateIssueResult {
  issue: IssueMetadata;
  /** Approved references that couldn't be linked post-create (REEF-083 AC4). */
  failed_references?: string[];
}

async function createIssueMutationFn({
  vault,
  prefix,
  create,
  references,
}: CreateIssueInput): Promise<CreateIssueResult> {
  const res = await apiFetch("/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vault,
      create,
      prefix,
      ...(references && references.length > 0 ? { references } : {}),
    }),
  });
  if (!res.ok) {
    await throwHttpError(res, `Failed to create issue: ${res.status}`);
  }
  const data = (await res.json()) as {
    issue: IssueMetadata;
    failed_references?: string[];
  };
  return data;
}

export function useCreateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createIssueMutationFn,
    onSuccess: (data, { vault }) => {
      const item = toListItem(data.issue);
      upsertIssue(vault, item);
      queryClient.setQueryData<IssueListItem[]>(
        ["issues", "list", vault],
        (current) => {
          if (!current) return current;
          if (current.some((issue) => issue.id === item.id)) return current;
          return [item, ...current];
        },
      );
      void queryClient.invalidateQueries({
        queryKey: ["issues", "list", vault],
      });
      void queryClient.invalidateQueries({
        queryKey: ["issues", "relations", vault],
      });
    },
  });
}
