"use client";

import { BlockedBadge } from "@/components/fields/BlockedBadge";
import { DateDisplay } from "@/components/fields/DateDisplay";
import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import { TypePill } from "@/components/fields/TypePill";
import { PriorityDot } from "@/components/ui/priority-dot";
import { StatusIcon } from "@/components/ui/status-icon";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { IssueQuickEditAnchor } from "@/features/issues/components/quick-edit/IssueQuickEditAnchor";
import { useIssueFlash } from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import {
  type PlanningKind,
  findPlanningName,
} from "@/features/planning/lib/planningItems";
import {
  usePlanningKindSingularLabels,
  usePriorityLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  type IssueListItem,
  type PlanningCatalog,
  type Priority,
  isResolvedStatus,
} from "@reef/core";
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface KanbanCardProps {
  issue: IssueListItem;
  vault?: string;
  /**
   * Whether this issue has at least one unresolved dependency. The board
   * precomputes the blocked-id set once and passes the resolved boolean down,
   * so the card does not hold the whole graph — keeping its props stable enough
   * for `memo` to skip unchanged cards. (REEF-097)
   */
  blocked?: boolean;
  planningCatalog?: PlanningCatalog;
  /**
   * Fired on a click that did not turn into a drag (PointerSensor
   * activationConstraint in KanbanBoard separates the two). Used to open
   * the issue detail slide-over.
   */
  onClick?: (id: string) => void;
}

interface KanbanCardSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  issue: IssueListItem;
  blocked?: boolean;
  planningCatalog?: PlanningCatalog;
  isDragging?: boolean;
  quickEditAnchor?: ReactNode;
}

interface PlanningContextItem {
  kind: PlanningKind;
  name: string;
}

/**
 * Planning context as a de-emphasized footer register, set off from the card
 * body by a hairline — sprint / milestone / release each marked by the
 * canonical `PlanningKindIcon` (shape, not color) instead of a boxed label
 * word. Each item owns the same icon and text columns so wrapping labels stay
 * left-aligned without reintroducing the bordered label tokens removed in
 * REEF-232.
 */
function PlanningContextStrip({
  items,
}: {
  items: readonly PlanningContextItem[];
}) {
  const planningKindSingular = usePlanningKindSingularLabels();
  if (items.length === 0) return null;

  return (
    <div
      className="mt-1.5 grid min-w-0 gap-0.5 border-t border-border-subtle pt-1.5 text-[10.5px] font-medium leading-4 text-muted-foreground"
      data-testid="kanban-planning-context"
    >
      {items.map((item) => {
        const label = planningKindSingular[item.kind];
        return (
          <span
            key={item.kind}
            aria-label={`${label}: ${item.name}`}
            className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] items-center gap-1"
            data-planning-kind={item.kind}
            title={`${label}: ${item.name}`}
          >
            <PlanningKindIcon kind={item.kind} decorative size={11} />
            <span className="min-w-0 truncate">{item.name}</span>
          </span>
        );
      })}
    </div>
  );
}

const KanbanCardSurface = forwardRef<HTMLDivElement, KanbanCardSurfaceProps>(
  function KanbanCardSurface(
    {
      issue,
      blocked = false,
      planningCatalog,
      isDragging = false,
      quickEditAnchor,
      className,
      ...props
    },
    ref,
  ) {
    const currentLogin = useCurrentUserLogin();
    const priorityLabels = usePriorityLabels();
    const [nowMs] = useState(() => Date.now());
    const dueTime = issue.due_date ? new Date(issue.due_date).getTime() : null;
    const isOverdue =
      dueTime != null && dueTime < nowMs && !isResolvedStatus(issue.status);
    const sprintName = findPlanningName(
      planningCatalog,
      "sprints",
      issue.sprint_id,
    );
    const milestoneName = findPlanningName(
      planningCatalog,
      "milestones",
      issue.milestone_id,
    );
    const releaseName = findPlanningName(
      planningCatalog,
      "releases",
      issue.release_id,
    );

    const planningContextItems: PlanningContextItem[] = [];
    if (sprintName) {
      planningContextItems.push({ kind: "sprints", name: sprintName });
    }
    if (milestoneName) {
      planningContextItems.push({ kind: "milestones", name: milestoneName });
    }
    if (releaseName) {
      planningContextItems.push({ kind: "releases", name: releaseName });
    }

    const hasPrimaryMeta = Boolean(
      issue.priority || issue.assigned_to || issue.start_date || issue.due_date,
    );

    return (
      <div
        ref={ref}
        data-testid="kanban-card"
        className={cn(
          "group relative rounded-md border border-border bg-elevated px-3 py-2.5",
          "cursor-pointer select-none transition-colors duration-[var(--duration-base)] ease-[var(--ease-signature)]",
          "hover:border-border hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
          isDragging && "opacity-50 cursor-grabbing shadow-md",
          className,
        )}
        {...props}
      >
        {quickEditAnchor}
        {/* Row 1 — header: status · id · type · (blocked, right) */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusIcon status={issue.status} size={12} />
          <span className="font-mono tabular-nums shrink-0">{issue.id}</span>
          <TypePill type={issue.issue_type} variant="kanban" />
          {blocked && <BlockedBadge variant="kanban" className="ml-auto" />}
        </div>

        {/* Row 2 — title: standalone, 2-line clamp, the visual anchor */}
        <h4 className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-medium text-foreground">
          {issue.title}
        </h4>

        {/* Row 3 — primary meta: priority (left) · dates + assignee (right).
            The assignee avatar is pinned as the flush-right trailing element so
            it lands at the same x on every card, independent of which other
            fields are present (REEF-128). */}
        {hasPrimaryMeta && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            {issue.priority && (
              <span className="inline-flex items-center gap-1 shrink-0">
                <PriorityDot priority={issue.priority as Priority} size={7} />
                <span className="text-foreground/75">
                  {priorityLabels[issue.priority as Priority]}
                </span>
              </span>
            )}
            {(issue.start_date || issue.due_date || issue.assigned_to) && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {(issue.start_date || issue.due_date) && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums text-[10.5px]">
                    {issue.start_date && (
                      <DateDisplay
                        date={issue.start_date}
                        format="short"
                        label="S"
                        titlePrefix="Start"
                      />
                    )}
                    {issue.start_date && issue.due_date && (
                      <span
                        className="h-2.5 w-px bg-border"
                        aria-hidden="true"
                      />
                    )}
                    {issue.due_date && (
                      <DateDisplay
                        date={issue.due_date}
                        format="short"
                        label="D"
                        titlePrefix="Due"
                        overdue={isOverdue}
                      />
                    )}
                  </span>
                )}
                {issue.assigned_to && (
                  <PersonAvatar
                    identityKey={issue.assigned_to}
                    size="xs"
                    tone={personToneFor(issue.assigned_to, currentLogin)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        <PlanningContextStrip items={planningContextItems} />
      </div>
    );
  },
);

export const KanbanCard = memo(function KanbanCard({
  issue,
  vault,
  blocked,
  planningCatalog,
  onClick,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: issue.id,
      data: { issue },
    });
  // Save-confirm flash: one-shot highlight when this card's edit lands
  // server-side. the flashing card re-renders; the hook auto-clears the
  // flag after the flash window so a later save can flash it again.
  const isFlashing = useIssueFlash(issue.id);
  const focused = useIssueKeyboardStore(
    (state) => state.focusedIssueId.board === issue.id,
  );
  const tabStopped = useIssueKeyboardStore(
    (state) => state.tabStopIssueId.board === issue.id,
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const focusIssue = useIssueKeyboardStore((state) => state.focusIssue);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useEffect(() => {
    if (
      focusRequest?.scope !== "board" ||
      focusRequest.issueId !== issue.id ||
      !cardRef.current
    ) {
      return;
    }
    cardRef.current.focus({ preventScroll: true });
    cardRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRequest, issue.id]);

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  function handleClick() {
    // Suppress the click that would fire at the end of a drag — pointerup
    // after a drag still emits click on most browsers.
    if (isDragging) return;
    onClick?.(issue.id);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(issue.id);
    }
  }

  return (
    <KanbanCardSurface
      ref={setCardRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => focusIssue("board", issue.id)}
      className={cn(
        focused && "border-brand/60 bg-brand/5 ring-2 ring-inset ring-brand/30",
        isFlashing && "reef-flash-card",
      )}
      role="button"
      tabIndex={focused || tabStopped ? 0 : -1}
      aria-selected={focused || undefined}
      data-shortcut-surface="issue-kanban-card"
      data-keyboard-focused={focused ? "true" : undefined}
      issue={issue}
      blocked={blocked}
      planningCatalog={planningCatalog}
      isDragging={isDragging}
      quickEditAnchor={
        vault ? (
          <IssueQuickEditAnchor scope="board" issue={issue} vault={vault} />
        ) : undefined
      }
    />
  );
});

export function KanbanCardPreview({
  issue,
  blocked,
  planningCatalog,
}: Omit<KanbanCardProps, "onClick">) {
  return (
    <KanbanCardSurface
      aria-hidden="true"
      issue={issue}
      blocked={blocked}
      planningCatalog={planningCatalog}
      className="pointer-events-none cursor-grabbing shadow-lg"
    />
  );
}
