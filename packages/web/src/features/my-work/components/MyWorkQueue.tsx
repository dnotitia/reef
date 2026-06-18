"use client";

import { STATUS_LABELS } from "@/components/fields/fieldKit";
import { StatusIcon } from "@/components/ui/status-icon";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { MyWorkRow } from "@/features/my-work/components/MyWorkRow";
import { type MyWorkItem, groupByStatus } from "@/features/my-work/lib/myWork";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useMemo } from "react";

export type GroupMode = "priority" | "status";

const GROUP_OPTIONS: ReadonlyArray<{ value: GroupMode; label: string }> = [
  { value: "priority", label: "By priority" },
  { value: "status", label: "By status" },
];

interface MyWorkQueueProps {
  items: MyWorkItem[];
  mode: GroupMode;
  onModeChange: (mode: GroupMode) => void;
}

/**
 * The personal work queue (REEF-181 AC6). Default "By priority" is one flat,
 * focus-sorted list — the answer to "what do I do next". "By status" partitions
 * the same focus order into status sections (AC2 "각 status의 목록"). The mode
 * lives in the URL (`?group=`) one level up so opening an issue and returning
 * preserves it.
 */
export function MyWorkQueue({ items, mode, onModeChange }: MyWorkQueueProps) {
  const searchParams = useSearchParams();
  const hrefFor = useCallback(
    (id: string) => buildOpenIssueHref(id, searchParams),
    [searchParams],
  );
  const groups = useMemo(
    () => (mode === "status" ? groupByStatus(items) : null),
    [mode, items],
  );

  return (
    <section className="flex flex-col gap-3" data-testid="my-work-queue">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            What to do next
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a header toggle group is not a form <fieldset>; role="group" + aria-label is the right semantics here. */}
        <div
          role="group"
          aria-label="Group the queue"
          className="inline-flex gap-0.5 rounded-lg border border-border-subtle bg-surface-subtle p-0.5"
        >
          {GROUP_OPTIONS.map((option) => {
            const active = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onModeChange(option.value)}
                data-testid={`my-work-group-${option.value}`}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-background">
        {mode === "priority" ? (
          items.map((item) => (
            <MyWorkRow
              key={item.issue.id}
              item={item}
              href={hrefFor(item.issue.id)}
              showStatus
            />
          ))
        ) : (
          <>
            {groups?.map((group) => (
              <Fragment key={group.status}>
                <GroupHeader status={group.status} count={group.count} />
                {group.items.map((item) => (
                  <MyWorkRow
                    key={item.issue.id}
                    item={item}
                    href={hrefFor(item.issue.id)}
                    showStatus={false}
                  />
                ))}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function GroupHeader({ status, count }: { status: Status; count: number }) {
  return (
    <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-subtle px-3 py-1.5 first:border-t-0">
      <StatusIcon status={status} size={13} decorative />
      <span className="text-xs font-semibold text-foreground/90">
        {STATUS_LABELS[status]}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </div>
  );
}
