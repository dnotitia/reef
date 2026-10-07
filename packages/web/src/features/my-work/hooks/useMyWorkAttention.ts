"use client";

import { useMyWorkResponse } from "@/features/my-work/hooks/useMyWorkData";
import { buildMyWork } from "@/features/my-work/lib/myWork";
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
 * It rides the page's account-scoped cross-workspace query. The deadline counts
 * use the same `buildMyWork` classification as the page, without loading its
 * workspace relation and planning context.
 */
export function useMyWorkAttention(): MyWorkAttention {
  const { data, login } = useMyWorkResponse();

  // The dashboard shell hosting this badge does not unmount, so a once-captured
  // `now` would freeze the deadline clock — an item crossing into the due-soon
  // window or past its deadline would not flip the badge tone until reload.
  // Re-read the clock on a coarse minute tick (deadlines are day-granular) so
  // the badge stays correct while the app is open without per-render churn.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    if (!login) return NONE;
    const { summary } = buildMyWork(data?.issues ?? [], [], { now });
    return {
      attention: summary.attention,
      overdue: summary.overdue,
      dueSoon: summary.dueSoon,
    };
  }, [data?.issues, login, now]);
}
