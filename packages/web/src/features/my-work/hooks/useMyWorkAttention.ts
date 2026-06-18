"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { buildMyWork, filterAssignedTo } from "@/features/my-work/lib/myWork";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useMemo, useState } from "react";

export interface MyWorkAttention {
  /** overdue + due-soon — the single "needs attention" number the sidebar
   * badge shows (REEF-204), not the total open count. */
  attention: number;
  overdue: number;
  dueSoon: number;
}

const NONE: MyWorkAttention = { attention: 0, overdue: 0, dueSoon: 0 };

/**
 * The sidebar My Work badge count (REEF-204): the signed-in user's overdue +
 * due-soon assigned work.
 *
 * It rides MyWorkPage's exact fetch rather than issuing its own — same scoped
 * vault + same `assignee` query produces the same `useIssueList` cache entry, so
 * the badge costs zero extra network and consistently agrees with the page KPIs.
 * The deadline counts are derived by the same `buildMyWork` pass the page uses
 * (graph/sprint never affect overdue/due-soon, so an empty graph is correct
 * here), keeping a single source of truth for the classification.
 */
export function useMyWorkAttention(): MyWorkAttention {
  const { vault } = useActiveVault();
  const login = useCurrentUserLogin();

  // Blank the vault until we have a login so a logged-out shell never fans out a
  // whole-vault query — mirrors MyWorkPage's scoping so the keys line up.
  const scopedVault = login ? vault : "";
  const query = useMemo(
    () => (login ? buildIssueQuery({ assignee: login }) : undefined),
    [login],
  );
  const { data } = useIssueList(scopedVault, query);

  // Captured once so the deadline boundary (and this memo) is stable across
  // re-renders; a per-render `Date.now()` would thrash the badge needlessly.
  const [now] = useState(() => Date.now());

  return useMemo(() => {
    if (!login) return NONE;
    // The server `assigned_to` facet is a substring `ILIKE`, so exact-scope the
    // rows to the full login before counting (REEF-181 autoreview).
    const issues = filterAssignedTo(data ?? [], login);
    const { summary } = buildMyWork(issues, [], { now });
    return {
      attention: summary.attention,
      overdue: summary.overdue,
      dueSoon: summary.dueSoon,
    };
  }, [data, login, now]);
}
