"use client";

import { BlockedBadge } from "@/components/fields/BlockedBadge";
import { DateDisplay } from "@/components/fields/DateDisplay";
import { DueIcon } from "@/components/fields/DueBadge";
import { TypePill } from "@/components/fields/TypePill";
import { DUE_COLORS } from "@/components/fields/fieldKit";
import { PriorityDot } from "@/components/ui/priority-dot";
import { StatusIcon } from "@/components/ui/status-icon";
import type { MyWorkItem } from "@/features/my-work/lib/myWork";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { memo } from "react";

interface MyWorkRowProps {
  item: MyWorkItem;
  /** Pre-built detail href that carries the current `?group=` query (REEF-222). */
  href: string;
  /**
   * Whether to render the per-row status glyph. False in the "By status"
   * grouping, where the section header already owns the status — so the value is
   * encoded once, not twice (the project's one-value-one-place rule).
   */
  showStatus: boolean;
}

/** Deadline meta — the canonical `DueIcon` (glyph + colour, colour-blind-safe)
 * carries the overdue / due-soon state once; the date text is just the date. */
function DueMeta({ item }: { item: MyWorkItem }) {
  const { issue, dueState } = item;
  if (!issue.due_date) return null;
  const tone =
    dueState === "overdue"
      ? DUE_COLORS.overdue
      : dueState === "due_soon"
        ? DUE_COLORS.due_soon
        : "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 type-mono-value",
        tone,
      )}
    >
      {dueState === "none" ? null : <DueIcon due={dueState} decorative />}
      <DateDisplay date={issue.due_date} format="short" titlePrefix="Due" />
    </span>
  );
}

/**
 * One row in the My Work queue (REEF-181). A `<Link>` so Cmd/middle/right-click
 * opens the issue in a new tab while a plain click soft-navigates to the detail
 * sheet over this page (REEF-221/222). Memoised on primitive-ish props so an
 * unrelated re-render skips untouched rows (REEF-097 / Vercel rerender-memo);
 * the assignee column is dropped — every item is the current user.
 */
export const MyWorkRow = memo(function MyWorkRow({
  item,
  href,
  showStatus,
}: MyWorkRowProps) {
  const { issue } = item;
  return (
    <Link
      href={href}
      data-testid={`my-work-row-${issue.id}`}
      className="group flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-subtle px-3 py-2 transition-colors duration-150 first:border-t-0 hover:bg-surface-hover focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
    >
      <span
        data-testid="my-work-row-identity"
        className="flex shrink-0 items-center gap-x-2"
      >
        {issue.priority ? (
          <PriorityDot priority={issue.priority} decorative />
        ) : (
          <span
            className="inline-block size-2 shrink-0 rounded-full bg-border-subtle"
            aria-hidden="true"
          />
        )}

        {showStatus ? (
          <StatusIcon status={issue.status} size={14} decorative />
        ) : null}

        <span className="w-[64px] shrink-0 truncate type-mono-value text-muted-foreground">
          {issue.id}
        </span>

        <TypePill
          type={issue.issue_type}
          variant="kanban"
          className="shrink-0"
        />
      </span>

      <span
        data-testid="my-work-row-title"
        title={issue.title}
        className="type-body min-w-0 basis-full break-words text-foreground sm:flex-1 sm:basis-auto sm:truncate sm:whitespace-nowrap"
      >
        {issue.title}
      </span>

      {item.blocked || issue.due_date ? (
        <span
          data-testid="my-work-row-meta"
          className="flex w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto"
        >
          {item.blocked ? (
            <BlockedBadge
              variant="list"
              count={item.blockerCount}
              className="shrink-0"
            />
          ) : null}

          <DueMeta item={item} />
        </span>
      ) : null}
    </Link>
  );
});
