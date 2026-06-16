"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type ActivitySuggestion,
  ActivitySuggestionSchema,
  type IssueCreateInput,
  type IssueUpdateInput,
} from "@reef/core";

export type UpdateDraftSuggestionPatch = { create: IssueCreateInput };

export interface UpdateStatusChangeSuggestionPatch {
  update: IssueUpdateInput;
  rationale?: string;
}

export type UpdateActivitySuggestionPatch =
  | UpdateDraftSuggestionPatch
  | UpdateStatusChangeSuggestionPatch;

export interface ActivitySuggestionMutationResult {
  suggestion: ActivitySuggestion;
}

export interface ApproveActivitySuggestionResult
  extends ActivitySuggestionMutationResult {
  issueId?: string;
  commit_hash?: string;
}

export async function updateActivitySuggestion(
  id: string,
  vault: string,
  patch: UpdateActivitySuggestionPatch,
): Promise<ActivitySuggestionMutationResult> {
  const res = await apiFetch(
    `/api/activity/suggestions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault, ...patch }),
    },
  );
  if (!res.ok) {
    await throwHttpError(res, `Failed to update suggestion: ${res.status}`);
  }
  return parseSuggestionMutationResult(await res.json());
}

export async function dismissActivitySuggestion(
  id: string,
  vault: string,
): Promise<ActivitySuggestionMutationResult> {
  const res = await apiFetch(
    `/api/activity/suggestions/${encodeURIComponent(id)}/dismiss`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault }),
    },
  );
  if (!res.ok) {
    await throwHttpError(res, `Failed to dismiss suggestion: ${res.status}`);
  }
  return parseSuggestionMutationResult(await res.json());
}

export async function approveActivitySuggestion(
  id: string,
  params: { vault: string; prefix?: string },
): Promise<ApproveActivitySuggestionResult> {
  const res = await apiFetch(
    `/api/activity/suggestions/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
  );
  if (!res.ok) {
    await throwHttpError(res, `Failed to approve suggestion: ${res.status}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const base = parseSuggestionMutationResult(raw);
  return {
    ...base,
    ...(typeof raw.issueId === "string" ? { issueId: raw.issueId } : {}),
    ...(typeof raw.commit_hash === "string"
      ? { commit_hash: raw.commit_hash }
      : {}),
  };
}

function parseSuggestionMutationResult(
  raw: unknown,
): ActivitySuggestionMutationResult {
  const result = raw as { suggestion?: unknown };
  return {
    suggestion: ActivitySuggestionSchema.parse(result.suggestion),
  };
}
