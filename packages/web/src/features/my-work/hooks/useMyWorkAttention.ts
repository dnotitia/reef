"use client";

import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { buildIssueQuery } from "@/features/issues/lib/buildIssueQuery";
import { buildMyWork } from "@/features/my-work/lib/myWork";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useEffect, useMemo, useState } from "react";

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
 * (graph/sprint does not affect overdue/due-soon, so an empty graph is correct
 * here), keeping a single canonical source for the classification.
 */
export function useMyWorkAttention(): MyWorkAttention {
  const { vault } = useActiveVault();
  const login = useCurrentUserLogin();

  // Blank the vault until we have a login so a logged-out shell does not fan out a
  // whole-vault query — mirrors MyWorkPage's scoping so the keys line up.
  const scopedVault = login ? vault : "";
  const query = useMemo(
    () => (login ? buildIssueQuery({ assignee: [login] }) : undefined),
    [login],
  );
  // Same identity-scoped query as MyWorkPage (shared cache entry); opt out of
  // placeholder reuse so an account switch does not count the previous login's
  // cached rows in the badge (REEF-267 autoreview).
  const { data } = useIssueList(scopedVault, query, {
    keepPreviousData: false,
  });

  // The dashboard shell hosting this badge does not unmount, so a once-captured
  // `now` would freeze the deadline clock — an item crossing into the due-soon
  // window or past its deadline would not flip the badge tone until reload.
  // Re-read the clock on a coarse minute tick (deadlines are day-granular, and
  // this mirrors ActivityRefreshButton's relative-time clock) so the badge stays
  // correct while the app is open without per-render churn.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    if (!login) return NONE;
    // The server `assigned_to` facet is now an exact match (REEF-267), so the
    // rows are already exactly this user's work — no client re-scope needed.
    const { summary } = buildMyWork(data ?? [], [], { now });
    return {
      attention: summary.attention,
      overdue: summary.overdue,
      dueSoon: summary.dueSoon,
    };
  }, [data, login, now]);
}
