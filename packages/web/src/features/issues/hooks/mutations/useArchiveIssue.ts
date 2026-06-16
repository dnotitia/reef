"use client";

import { useUpdateIssue } from "./useUpdateIssue";

interface ArchiveIssueInput {
  id: string;
  vault: string;
}

/**
 * Archive / unarchive an issue by setting (or clearing) `archived_at`.
 *
 * `archived_at` is orthogonal to `status` — archiving preserves the
 * `in_progress`/`done` state so unarchive restores the prior step without
 * the user having to remember it. Hidden from default views via
 * `archived_at == null`. Unarchive sends `archived_at: null`; the PATCH
 * route forwards it to `akbUpdateIssue.mergeIssue`, which deletes the key
 * so the YAML does not persists `null`.
 */
export function useArchiveIssue() {
  const update = useUpdateIssue();

  return {
    ...update,
    archive: (input: ArchiveIssueInput) =>
      update.mutateAsync({
        ...input,
        patch: { archived_at: new Date().toISOString() },
      }),
    unarchive: (input: ArchiveIssueInput) =>
      update.mutateAsync({
        ...input,
        patch: { archived_at: null },
      }),
  };
}
