"use client";

import { TypePill } from "@/components/fields/TypePill";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueContextMenu } from "@/features/issues/components/context-menu/IssueContextMenu";
import { IssueQuickEditAnchor } from "@/features/issues/components/quick-edit/IssueQuickEditAnchor";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useIssueFlash } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useStatusLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type {
  Collaborator,
  IssueListItem,
  PlanningCatalog,
  Status,
} from "@reef/core";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { StatusEpicLane } from "../../issues/lib/grouping";
import { statusEpicOccurrenceKey } from "../../issues/lib/grouping";
import { KanbanColumn } from "./KanbanColumn";

const EMPTY_BLOCKED_IDS: ReadonlySet<string> = new Set();

export interface KanbanEpicLaneProps {
  lane: StatusEpicLane;
  vault: string;
  blockedIds?: ReadonlySet<string>;
  planningCatalog?: PlanningCatalog;
  assignees?: readonly Collaborator[];
  onIssueClick?: (id: string) => void;
  onToggle: (expanded: boolean) => void;
  collapsed: boolean;
  dragEnabled?: boolean;
}

function statusDistribution(
  lane: StatusEpicLane,
  statusLabels: Readonly<Record<Status, string>>,
): string {
  return WORKFLOW_STATUS_OPTIONS.filter(
    (status) => (lane.statusCounts[status] ?? 0) > 0,
  )
    .map((status) => `${statusLabels[status]} ${lane.statusCounts[status]}`)
    .join(", ");
}

function KanbanEpicHeader({
  lane,
  vault,
  planningCatalog,
  assignees,
  onIssueClick,
  onToggle,
  collapsed,
  childrenId,
  titleId,
  summaryId,
}: Omit<KanbanEpicLaneProps, "blockedIds" | "dragEnabled"> & {
  childrenId: string;
  titleId: string;
  summaryId: string;
}) {
  const t = useTranslations("board");
  const statusLabels = useStatusLabels();
  const currentLogin = useCurrentUserLogin();
  const occurrenceKey = statusEpicOccurrenceKey(lane.epic.id);
  const identityRef = useRef<HTMLButtonElement | null>(null);
  const isFlashing = useIssueFlash(lane.epic.id);
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const focused = useIssueKeyboardStore(
    (state) =>
      state.focusedOccurrenceKey.board === occurrenceKey ||
      (!state.focusedOccurrenceKey.board &&
        state.focusedIssueId.board === lane.epic.id),
  );
  const tabStopped = useIssueKeyboardStore(
    (state) =>
      state.tabStopOccurrenceKey.board === occurrenceKey ||
      (!state.tabStopOccurrenceKey.board &&
        state.tabStopIssueId.board === lane.epic.id),
  );

  const distribution = useMemo(
    () => statusDistribution(lane, statusLabels) || t("epicNoVisibleChildren"),
    [lane, statusLabels, t],
  );
  const progressText = t("epicProgress", {
    done: lane.completedChildren,
    total: lane.totalChildren,
  });
  const summary = t("epicSummary", {
    title: lane.epic.title,
    status: statusLabels[lane.epic.status],
    progress: progressText,
    distribution,
    state: collapsed ? t("epicCollapsed") : t("epicExpanded"),
  });
  const toggleLabel = collapsed
    ? t("expandEpic", { title: lane.epic.title })
    : t("collapseEpic", { title: lane.epic.title });

  useLayoutEffect(() => {
    if (
      focusRequest?.scope !== "board" ||
      (focusRequest.occurrenceKey ?? focusRequest.issueId) !== occurrenceKey
    ) {
      return;
    }
    identityRef.current?.focus({ preventScroll: true });
    identityRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [focusRequest, occurrenceKey]);

  function stopShortcutPropagation(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  }

  function handleIdentityClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onIssueClick?.(lane.epic.id);
  }

  const content = (
    <div
      data-testid="kanban-epic-header"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border-b border-border-subtle bg-surface-subtle"
    >
      <div className="grid min-w-0 gap-2 border-b border-border-subtle bg-surface-subtle px-3 py-3 lg:flex lg:items-start lg:gap-3">
        <h3 id={titleId} className="min-w-0 lg:flex-1">
          <button
            ref={identityRef}
            type="button"
            data-shortcut-surface="issue-kanban-card"
            data-occurrence-key={occurrenceKey}
            data-keyboard-focused={focused ? "true" : undefined}
            aria-selected={focused || undefined}
            tabIndex={focused || tabStopped ? 0 : -1}
            className={cn(
              "grid min-w-0 w-full max-w-full grid-cols-1 gap-y-1 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40 lg:flex lg:items-center lg:gap-2",
              isFlashing && "reef-flash-card",
            )}
            onClick={handleIdentityClick}
            onKeyDown={stopShortcutPropagation}
            onFocus={() =>
              useIssueKeyboardStore
                .getState()
                .focusOccurrence("board", occurrenceKey, lane.epic.id)
            }
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2 lg:order-1">
              <StatusIcon status={lane.epic.status} size={14} decorative />
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {lane.epic.id}
              </span>
              <TypePill type={lane.epic.issue_type} variant="kanban" />
            </span>
            <span className="min-w-0 whitespace-normal text-[14px] font-semibold text-foreground [overflow-wrap:anywhere] lg:order-2 lg:flex-1 lg:truncate">
              {lane.epic.title}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground lg:order-3 lg:ml-auto">
              {statusLabels[lane.epic.status]}
            </span>
          </button>
        </h3>

        <div className="flex shrink-0 items-center justify-end gap-1">
          <IssueQuickEditAnchor
            scope="board"
            issue={lane.epic}
            vault={vault}
            occurrenceKey={occurrenceKey}
          />
          <button
            type="button"
            data-testid="kanban-epic-toggle"
            aria-expanded={!collapsed}
            aria-controls={childrenId}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40 motion-reduce:transition-none"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(collapsed);
            }}
            onKeyDown={stopShortcutPropagation}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 transition-transform duration-150 motion-reduce:transition-none",
                !collapsed && "rotate-90",
              )}
            />
            <span className="sr-only">{toggleLabel}</span>
          </button>
        </div>
      </div>

      <div id={summaryId} className="sr-only">
        {summary}
      </div>

      <div className="flex min-w-0 flex-col items-stretch gap-1.5 px-4 py-2 text-xs text-muted-foreground lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-1">
        {lane.totalChildren > 0 ? (
          <div
            role="progressbar"
            aria-valuenow={lane.completedChildren}
            aria-valuemin={0}
            aria-valuemax={lane.totalChildren}
            aria-label={progressText}
            data-testid="kanban-epic-progress"
            className="h-1.5 w-full flex-none overflow-hidden rounded-full bg-secondary lg:w-auto lg:min-w-24 lg:max-w-52 lg:flex-1"
          >
            <div
              className="h-full origin-left rounded-full bg-brand-fill transition-transform duration-300 motion-reduce:transition-none"
              style={{
                transform: `scaleX(${lane.completedChildren / lane.totalChildren})`,
              }}
            />
          </div>
        ) : null}
        <span
          className="shrink-0 tabular-nums"
          data-testid="kanban-epic-progress-text"
        >
          {progressText}
        </span>
        <span
          className="w-full min-w-0 whitespace-normal [overflow-wrap:anywhere] lg:w-auto lg:flex-1 lg:truncate"
          data-testid="kanban-epic-status-distribution"
        >
          {t("epicStatusDistribution", { distribution })}
        </span>
      </div>
    </div>
  );

  return (
    <IssueContextMenu
      issue={lane.epic}
      vault={vault}
      currentLogin={currentLogin}
      planningCatalog={planningCatalog}
      assignees={assignees}
    >
      {content}
    </IssueContextMenu>
  );
}

export function KanbanEpicLane({
  lane,
  vault,
  blockedIds = EMPTY_BLOCKED_IDS,
  planningCatalog,
  assignees,
  onIssueClick,
  onToggle,
  collapsed,
  dragEnabled = true,
}: KanbanEpicLaneProps) {
  const childrenId = useId();
  const titleId = useId();
  const summaryId = useId();

  return (
    <div className="min-w-0 w-full" data-testid="kanban-epic-lane-wrapper">
      <section
        data-testid="kanban-epic-lane"
        data-epic-id={lane.epic.id}
        data-epic-expanded={collapsed ? "false" : "true"}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className="flex min-w-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-page"
      >
        <KanbanEpicHeader
          lane={lane}
          vault={vault}
          planningCatalog={planningCatalog}
          assignees={assignees}
          onIssueClick={onIssueClick}
          onToggle={onToggle}
          collapsed={collapsed}
          childrenId={childrenId}
          titleId={titleId}
          summaryId={summaryId}
        />
        <div
          id={childrenId}
          data-testid="kanban-epic-children"
          hidden={collapsed}
          className="min-w-0"
        >
          {!collapsed && (
            <div className="grid min-w-0 grid-cols-1 gap-2 p-2 md:grid-cols-2 lg:flex lg:flex-nowrap">
              {lane.children.map(({ bucket, issues }) => (
                <KanbanColumn
                  key={bucket.id}
                  bucket={bucket}
                  vault={vault}
                  issues={issues}
                  blockedIds={blockedIds}
                  planningCatalog={planningCatalog}
                  assignees={assignees}
                  onIssueClick={onIssueClick}
                  dragEnabled={dragEnabled}
                  className="h-auto min-h-24 rounded-none border-0 bg-transparent lg:min-h-32"
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
