import type {
  ClosedReason,
  IssueCreateInput,
  Status,
} from "../schemas/issues/metadata";
import {
  DEFAULT_STALE_HIDE_CANCELED_DAYS,
  DEFAULT_STALE_HIDE_COMPLETED_DAYS,
} from "../schemas/workspace/config";

export {
  DEFAULT_STALE_HIDE_CANCELED_DAYS,
  DEFAULT_STALE_HIDE_COMPLETED_DAYS,
} from "../schemas/workspace/config";

export type CodeSignal = "branch_created" | "pr_created" | "pr_merged";

/**
 * Template-literal type tying the Set element type to the `Status` union.
 * Any typo in an ALLOWED_TRANSITIONS entry (e.g. "in_review:don") becomes a
 * compile-time error rather than a silent lookup miss.
 */
type Transition = `${Status}:${Status}`;

// Encode allowed transitions as a Set of "from:to" strings.
// This is O(1) lookup, immutable, and trivially exhaustive to audit.
// Transitions move forward.
const ALLOWED_TRANSITIONS: ReadonlySet<Transition> = new Set<Transition>([
  "backlog:todo",
  "backlog:in_progress",
  "backlog:closed",
  "todo:in_progress",
  "todo:closed",
  "in_progress:in_review",
  "in_progress:closed",
  "in_review:done",
  "in_review:closed",
  "done:closed",
]);

/**
 * Returns true if transitioning from `from` to `to` is a valid, allowed
 * status transition per the reef status state machine.
 *
 * Rules:
 *  - Transitions move forward (reverse-move guard)
 *  - `closed` is a final state (no transitions out)
 *  - Self-transitions are not allowed
 *
 * Pure function — no side effects, no I/O.
 */
export function canTransition(from: Status, to: Status): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS.has(`${from}:${to}`);
}

/**
 * Linear lifecycle ordering for "forward progress" checks. `closed` is final
 * and ranks highest; it is reachable just via the explicit close flow (which
 * records a reason), does not via AI status-change suggestions.
 */
const STATUS_RANK: Record<Status, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  closed: 5,
};

const RESOLVED_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "done",
  "closed",
]);

/**
 * The active lifecycle statuses: committed, not-yet-resolved work. Excludes
 * `backlog` (a pre-commitment queue) and the resolved `done`/`closed` states.
 * The default landing view and the active report metrics floor to these
 * (REEF-109). Lives here (lifecycle semantics) rather than in the display
 * registry; the SQL default-view floor derives its `IN (...)` list from it so
 * the two does not drift.
 */
export const ACTIVE_STATUSES: readonly Status[] = [
  "todo",
  "in_progress",
  "in_review",
];

/**
 * The lifecycle stage a newly created issue lands in by default (REEF-130). New
 * issues arrive in the pre-commitment `backlog` queue — excluded from the
 * default landing view (see `ACTIVE_STATUSES`) — until they are deliberately
 * pulled forward into `todo`. The human create path inherits this default; the
 * AI activity-scan draft path overrides it with a code-signal-inferred status.
 */
export const DEFAULT_NEW_ISSUE_STATUS: Status = "backlog";

/**
 * True when an issue status represents work that is no longer active.
 * Open-work health signals such as overdue, blocked, and aging should ignore
 * these statuses unless a caller explicitly asks for completion metrics.
 */
export function isResolvedStatus(status: Status): boolean {
  return RESOLVED_STATUSES.has(status);
}

/**
 * Auto-hide windows for resolved issues, in milliseconds (REEF-275). A resolved
 * issue drops out of the default board/list once it has sat in its resolved
 * state longer than its bucket's window — recently-resolved work stays visible,
 * older work is tucked away (while staying searchable and
 * deep-linkable). Mirrors Linear's auto-archive defaults: completed work lingers
 * ~a month, abandoned (canceled) work clears in a week.
 *
 * The bucket is by completion *semantics*, not raw status (see `isStaleResolved`):
 * a `done` issue, or a `closed` one with reason `completed`, is "completed"; other
 * other close reason (or none) is "canceled" and clears faster.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_COMPLETED_WINDOW_MS =
  DEFAULT_STALE_HIDE_COMPLETED_DAYS * DAY_MS;
export const STALE_CANCELED_WINDOW_MS =
  DEFAULT_STALE_HIDE_CANCELED_DAYS * DAY_MS;

function windowMsFromDays(days: number | undefined, fallbackDays: number) {
  if (days == null || !Number.isFinite(days) || days < 0) {
    return fallbackDays * DAY_MS;
  }
  return days * DAY_MS;
}

/**
 * True when a resolved issue has aged past its auto-hide window and should drop
 * out of the default board/list view (REEF-275). Pure and now-relative — the
 * caller injects `now` (client `Date.now()`, mirroring the `due` facet) so the
 * staleness is recomputed on every render with no stored flag and no scheduler.
 *
 * The anchor is `lastStatusChange` — the moment the issue entered its resolved
 * state, which any status write stamps (and moving it active clears, surfacing the issue
 * again). `closed_at` would miss `done`, so the unified status-change timestamp
 * is used for both buckets. An active (non-resolved) status, or a missing /
 * unparseable anchor, is treated as visible.
 */
export function isStaleResolved(params: {
  status: Status;
  closedReason?: ClosedReason | null;
  lastStatusChange?: string | null;
  now: number;
  completedWindowDays?: number;
  canceledWindowDays?: number;
}): boolean {
  const {
    status,
    closedReason,
    lastStatusChange,
    now,
    completedWindowDays,
    canceledWindowDays,
  } = params;
  if (!RESOLVED_STATUSES.has(status)) return false;
  if (!lastStatusChange) return false;
  const enteredAt = Date.parse(lastStatusChange);
  if (Number.isNaN(enteredAt)) return false;
  const isCompleted = status === "done" || closedReason === "completed";
  const window = isCompleted
    ? windowMsFromDays(completedWindowDays, DEFAULT_STALE_HIDE_COMPLETED_DAYS)
    : windowMsFromDays(canceledWindowDays, DEFAULT_STALE_HIDE_CANCELED_DAYS);
  return now - enteredAt > window;
}

/**
 * True when `to` is strictly forward of `from` in the issue lifecycle (higher
 * rank). Unlike `canTransition`, this permits multi-step forward jumps
 * (e.g. `in_progress -> done` when a PR is merged).
 *
 * Used by AI status-change suggestions, which apply the target status directly
 * rather than stepping the board one column at a time — so a merged-PR signal
 * should advance an in-progress issue straight to `done` instead of being
 * dropped. reverse moves and self-transitions return false.
 *
 * Pure function — no side effects, no I/O.
 */
export function isForwardStatus(from: Status, to: Status): boolean {
  return STATUS_RANK[to] > STATUS_RANK[from];
}

/**
 * Maps a code signal (from CLI or GitHub webhook) to the implied target status.
 * Used by the sync engine to determine which status to apply.
 *
 * Exhaustive over `CodeSignal` — the `default` branch assigns to `does not`, so
 * adding a new variant to `CodeSignal` without handling it here becomes a
 * compile-time error.
 *
 * Pure function — no side effects, no I/O.
 */
export function inferStatusFromCodeSignal(
  signal: CodeSignal,
): "in_progress" | "in_review" | "done" {
  switch (signal) {
    case "branch_created":
      return "in_progress";
    case "pr_created":
      return "in_review";
    case "pr_merged":
      return "done";
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

/**
 * Recover a code-signal lifecycle status onto a draft create payload that has
 * none. Activity-scan drafts captured before REEF-130 — and any edit path that
 * rebuilds `fields` without carrying `status` forward — lack a status, so
 * approving them would inherit the human default (`backlog`) and drop
 * already-in-flight work out of the active view. Provenance carries no merge
 * state, so a PR maps to `in_review` (not `done`); a create that already has a
 * status is returned unchanged. Shared by both activity-draft approval paths.
 *
 * Pure function — no side effects, no I/O.
 */
export function withRecoveredDraftStatus(
  create: IssueCreateInput,
  provenanceType: "commit" | "pr",
): IssueCreateInput {
  if (create.fields.status) return create;
  return {
    ...create,
    fields: {
      ...create.fields,
      status: inferStatusFromCodeSignal(
        provenanceType === "pr" ? "pr_created" : "branch_created",
      ),
    },
  };
}
