"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { IssueCreateInput } from "@reef/core";

/**
 * approveDraft posts an AI draft to `POST /api/drafts/approve` and returns
 * the allocated issue id. The route is preferred over a Server Action so
 * Next.js dev-mode logging doesn't leak the auth header. The `.action`
 * filename is a historical artifact.
 */

export interface ApproveDraftInput {
  create: IssueCreateInput;
}

export interface ApproveDraftResult {
  issueId: string;
}

export async function approveDraft(
  draft: ApproveDraftInput,
  vault: string,
  prefix: string,
): Promise<ApproveDraftResult> {
  const res = await apiFetch("/api/drafts/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vault,
      prefix,
      create: draft.create,
    }),
  });

  if (!res.ok) {
    await throwHttpError(res, `Failed to commit draft (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { issueId: string };
  return { issueId: data.issueId };
}
