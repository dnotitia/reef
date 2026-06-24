"use client";

import type {
  MyWorkSprint,
  MyWorkSummary as MyWorkSummaryData,
} from "@/features/my-work/lib/myWork";
import { useDueLabels, useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Status } from "@reef/core";
import { useTranslations } from "next-intl";

/** Segment fill per stage — the status tokens (fill, not text, here in the
 * distribution strip; rows still encode status as an icon colour). */
const STATUS_SEGMENT: Record<Status, string> = {
  backlog: "var(--status-backlog)",
  todo: "var(--status-open)",
  in_progress: "var(--status-in-progress)",
  in_review: "var(--status-in-review)",
  done: "var(--status-done)",
  closed: "var(--status-closed)",
};

type TileTone = "default" | "warn" | "danger";

/** A stat tile mirroring the Reports HealthSummary idiom: a left rail + tinted
 * value for the warn/danger tones, paired with a redundant label. */
function Tile({
  label,
  value,
  tone = "default",
  hint,
  testId,
}: {
  label: string;
  value: number;
  tone?: TileTone;
  hint?: string;
  testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      className={cn(
        "relative flex min-h-[78px] flex-col justify-between gap-1 overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle p-3",
        tone === "danger" &&
          "border-destructive/25 bg-destructive/[0.035] pl-4",
        tone === "warn" && "pl-4",
      )}
    >
      {tone === "default" ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            tone === "danger" ? "bg-destructive" : "bg-priority-high",
          )}
        />
      )}
      <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 items-end justify-between gap-2">
        <span
          className={cn(
            "shrink-0 font-mono text-2xl font-semibold leading-none tabular-nums",
            tone === "danger" && "text-destructive",
            tone === "warn" && "text-priority-high",
          )}
        >
          {value}
        </span>
        {hint ? (
          <span className="truncate text-right text-[11px] font-medium text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** Current-sprint tile (AC5): remaining count over a done/total progress bar. */
function SprintTile({ sprint }: { sprint: MyWorkSprint }) {
  const t = useTranslations("myWork");
  const pct = sprint.total > 0 ? sprint.done / sprint.total : 0;
  return (
    <li
      data-testid="my-work-tile-sprint"
      className="relative flex min-h-[78px] flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle p-3"
    >
      <span
        className="truncate text-[11px] uppercase tracking-wide text-muted-foreground"
        title={sprint.name}
      >
        {t("sprintLabel", { name: sprint.name })}
      </span>
      <span className="flex items-end gap-1">
        {t.rich("sprintLeft", {
          count: sprint.remaining,
          value: (chunks) => (
            <span className="font-mono text-2xl font-semibold leading-none tabular-nums">
              {chunks}
            </span>
          ),
          label: (chunks) => (
            <span className="text-[11px] font-medium text-muted-foreground">
              {chunks}
            </span>
          ),
        })}
      </span>
      <div className="flex flex-col gap-1">
        <div
          aria-hidden="true"
          className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-status-done motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out"
            style={{ transform: `scaleX(${pct})` }}
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {t("sprintDone", { done: sprint.done, total: sprint.total })}
        </span>
      </div>
    </li>
  );
}

/** Status distribution of my open work (AC2). The bar drops zero-width stages;
 * the legend keeps every stage so each count is shown even at zero. */
function StageBar({
  byStatus,
  total,
}: {
  byStatus: MyWorkSummaryData["byStatus"];
  total: number;
}) {
  const t = useTranslations("myWork");
  const statusLabels = useStatusLabels();
  const denom = total || 1;
  return (
    <div
      data-testid="my-work-stagebar"
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3"
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("openWorkByStage")}
      </span>
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        {byStatus
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.status}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(segment.count / denom) * 100}%`,
                backgroundColor: STATUS_SEGMENT[segment.status],
              }}
              title={`${statusLabels[segment.status]}: ${segment.count}`}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {byStatus.map((segment) => (
          <li
            key={segment.status}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-[3px]"
              style={{
                backgroundColor: STATUS_SEGMENT[segment.status],
                opacity: segment.count === 0 ? 0.4 : 1,
              }}
            />
            <span className="text-foreground/80">
              {statusLabels[segment.status]}
            </span>
            <span className="font-mono tabular-nums">{segment.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The summary strip above the queue (REEF-181): WIP / due-soon / overdue / sprint
 * tiles (AC3·AC4·AC5) over a status-distribution bar (AC2). All counts are
 * derived from the same `useIssueList` pass — no extra fetch.
 */
export function MyWorkSummary({ summary }: { summary: MyWorkSummaryData }) {
  const t = useTranslations("myWork");
  const dueLabels = useDueLabels();
  return (
    <section className="flex flex-col gap-3" data-testid="my-work-summary">
      <ul
        className={cn(
          "grid grid-cols-2 gap-3",
          summary.sprint ? "sm:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        <Tile
          label={t("inProgress")}
          value={summary.wip}
          hint={t("hintActiveWip")}
          testId="my-work-tile-wip"
        />
        <Tile
          label={dueLabels.due_soon}
          value={summary.dueSoon}
          tone={summary.dueSoon > 0 ? "warn" : "default"}
          hint={t("hintWithin7Days")}
          testId="my-work-tile-due-soon"
        />
        <Tile
          label={dueLabels.overdue}
          value={summary.overdue}
          tone={summary.overdue > 0 ? "danger" : "default"}
          hint={t("hintPastDue")}
          testId="my-work-tile-overdue"
        />
        {summary.sprint ? <SprintTile sprint={summary.sprint} /> : null}
      </ul>
      <StageBar byStatus={summary.byStatus} total={summary.open} />
    </section>
  );
}
