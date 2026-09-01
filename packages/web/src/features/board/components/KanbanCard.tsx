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
import { useIssueUpdateState } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { IssueContextMenu } from "@/features/issues/components/context-menu/IssueContextMenu";
import {
  useIssueFlash,
  useIssueReorderFlash,
} from "@/features/issues/stores/useFlashStore";
import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import {
  IssueReorderStatus,
  type IssueReorderSurfaceState,
} from "@/features/issues/components/shared/IssueReorderFeedback";
import {
  type PlanningKind,
  findPlanningName,
} from "@/features/planning/lib/planningItems";
import {
  usePlanningKindSingularLabels,
  useFieldNameLabels,
  usePriorityLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type Collaborator,
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { IssueGroupBucket } from "../../issues/lib/grouping";

type QuickEditPatchField = "status" | "priority" | "assigned_to" | "labels";

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
  assignees?: readonly Collaborator[];
  /**
   * Fired on a click that did not turn into a drag (PointerSensor
   * activationConstraint in KanbanBoard separates the two). Used to open
   * the issue detail slide-over.
   */
  onClick?: (id: string) => void;
  occurrenceKey?: string;
  dragEnabled?: boolean;
  readOnlyReason?: string;
  bucket?: IssueGroupBucket;
  pendingFields?: readonly QuickEditPatchField[];
  updateMessage?: string;
  reorderState?: IssueReorderSurfaceState | null;
}

interface KanbanCardSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  issue: IssueListItem;
  currentLogin?: string | null;
  blocked?: boolean;
  planningCatalog?: PlanningCatalog;
  isDragging?: boolean;
  quickEditAnchor?: ReactNode;
  readOnlyReason?: string;
  readOnlyTooltipId?: string;
  pendingFields?: readonly QuickEditPatchField[];
  updateMessage?: string;
  reorderState?: IssueReorderSurfaceState | null;
  reorderSuccess?: boolean;
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
      className="type-caption mt-1.5 grid min-w-0 gap-0.5 border-t border-border-subtle pt-1.5 font-medium text-muted-foreground"
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
      currentLogin = null,
      blocked = false,
      planningCatalog,
      isDragging = false,
      quickEditAnchor,
      readOnlyReason,
      readOnlyTooltipId,
      pendingFields = [],
      updateMessage,
      reorderState,
      reorderSuccess = false,
      className,
      ...props
    },
    ref,
  ) {
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
    const surfaceReorderState =
      reorderState ?? (reorderSuccess ? "success" : null);

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
      issue.priority ||
        issue.assigned_to ||
        issue.start_date ||
        issue.due_date ||
        pendingFields.includes("priority") ||
        pendingFields.includes("assigned_to"),
    );
    const statusPending = pendingFields.includes("status");
    const priorityPending = pendingFields.includes("priority");
    const assigneePending = pendingFields.includes("assigned_to");

    return (
      <div
        ref={ref}
        data-testid="kanban-card"
        data-issue-id={issue.id}
        className={cn(
          "group relative min-w-0 rounded-md border border-border bg-surface-card px-3 py-2.5",
          "cursor-pointer select-none transition-colors duration-[var(--duration-base)] ease-[var(--ease-signature)]",
          "hover:border-border hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:border-brand-focus/60 focus-visible:bg-brand-fill/5",
          isDragging && "opacity-50 cursor-grabbing shadow-md",
          readOnlyReason && "cursor-not-allowed",
          reorderSuccess && "reef-reorder-success-card",
          className,
        )}
        aria-busy={
          pendingFields.length > 0 || surfaceReorderState === "pending"
            ? true
            : undefined
        }
        aria-describedby={readOnlyTooltipId}
        aria-disabled={readOnlyReason ? true : undefined}
        data-reorder-state={surfaceReorderState ?? undefined}
        title={readOnlyReason}
        {...props}
      >
        {readOnlyReason && readOnlyTooltipId ? (
          <span
            id={readOnlyTooltipId}
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-0 z-20 w-max max-w-[16rem] -translate-x-1/2 -translate-y-[calc(100%+0.35rem)] rounded-md border border-border bg-surface-popover px-2 py-1 type-caption font-medium text-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {readOnlyReason}
          </span>
        ) : null}
        {updateMessage && (
          <span
            role="status"
            aria-live="polite"
            className="sr-only"
            data-issue-update-announcement
          >
            {updateMessage}
          </span>
        )}
        {quickEditAnchor}
        {/* Row 1 — header: status · id · type · (blocked, right) */}
        <div className="flex min-w-0 items-center gap-1.5 type-caption text-muted-foreground">
          <span
            data-issue-update-field="status"
            aria-busy={statusPending || undefined}
            className="inline-flex shrink-0 items-center"
          >
            <StatusIcon status={issue.status} size={12} />
            {statusPending && (
              <LoaderCircle
                className="ml-1 size-3 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
          </span>
          <span className="type-mono-value shrink-0">{issue.id}</span>
          <TypePill type={issue.issue_type} variant="kanban" />
          {surfaceReorderState && surfaceReorderState !== "success" && (
            <IssueReorderStatus
              state={surfaceReorderState}
              className="ml-auto"
            />
          )}
          {blocked && (
            <BlockedBadge
              variant="kanban"
              className={surfaceReorderState ? undefined : "ml-auto"}
            />
          )}
        </div>

        {/* Row 2 — title: standalone, 2-line clamp, the visual anchor */}
        <h4 className="type-body mt-1.5 min-w-0 line-clamp-2 font-semibold text-foreground">
          {issue.title}
        </h4>

        {/* Row 3 — primary meta: priority (left) · dates + assignee (right).
            The assignee avatar is pinned as the flush-right trailing element so
            it lands at the same x on every card, independent of which other
            fields are present (REEF-128). */}
        {hasPrimaryMeta && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-caption text-muted-foreground">
            {issue.priority && (
              <span
                className="inline-flex items-center gap-1 shrink-0"
                data-issue-update-field="priority"
                aria-busy={priorityPending || undefined}
              >
                <PriorityDot priority={issue.priority as Priority} size={7} />
                <span className="text-foreground/75">
                  {priorityLabels[issue.priority as Priority]}
                </span>
                {priorityPending && (
                  <LoaderCircle
                    className="size-3 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                )}
              </span>
            )}
            {!issue.priority && priorityPending && (
              <span
                className="inline-flex items-center gap-1 shrink-0"
                data-issue-update-field="priority"
                aria-busy="true"
              >
                <LoaderCircle
                  className="size-3 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              </span>
            )}
            {(issue.start_date ||
              issue.due_date ||
              issue.assigned_to ||
              assigneePending) && (
              <div className="ml-auto flex min-w-0 max-w-full shrink items-center gap-2">
                {(issue.start_date || issue.due_date) && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 type-mono-value">
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
                {(issue.assigned_to || assigneePending) && (
                  <span
                    className="ml-auto inline-flex items-center"
                    data-issue-update-field="assigned_to"
                    aria-busy={assigneePending || undefined}
                  >
                    {issue.assigned_to && (
                      <PersonAvatar
                        identityKey={issue.assigned_to}
                        size="xs"
                        tone={personToneFor(issue.assigned_to, currentLogin)}
                      />
                    )}
                    {assigneePending && (
                      <LoaderCircle
                        className="ml-1 size-3 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    )}
                  </span>
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

const KanbanCardContent = memo(function KanbanCardContent({
  issue,
  vault,
  blocked,
  planningCatalog,
  assignees,
  onClick,
  occurrenceKey,
  dragEnabled = true,
  readOnlyReason,
  bucket,
  pendingFields = [],
  updateMessage,
  reorderState = null,
}: KanbanCardProps) {
  const currentLogin = useCurrentUserLogin();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: occurrenceKey ?? issue.id,
    data: { issue, occurrenceKey, bucket },
    disabled: !dragEnabled,
  });
  // Epic grouping disables relationship drag at the column/drop-target seam,
  // but its child cards remain ordinary interactive issue surfaces. Omit the
  // sortable ARIA attributes/listeners so dnd-kit's disabled drag state does
  // not make an otherwise clickable card announce as disabled.
  const sortableAttributes = bucket?.groupBy === "epic" ? {} : attributes;
  const sortableListeners = bucket?.groupBy === "epic" ? {} : listeners;
  // Save-confirm flash: one-shot highlight when this card's edit lands
  // server-side. the flashing card re-renders; the hook auto-clears the
  // flag after the flash window so a later save can flash it again.
  const isFlashing = useIssueFlash(vault ?? "", issue.id);
  const reorderSuccess = useIssueReorderFlash(vault ?? "", issue.id);
  const keyboardOccurrenceKey = occurrenceKey ?? issue.id;
  const focused = useIssueKeyboardStore(
    (state) =>
      state.focusedOccurrenceKey.board === keyboardOccurrenceKey ||
      (!state.focusedOccurrenceKey.board &&
        state.focusedIssueId.board === issue.id),
  );
  const tabStopped = useIssueKeyboardStore(
    (state) =>
      state.tabStopOccurrenceKey.board === keyboardOccurrenceKey ||
      (!state.tabStopOccurrenceKey.board &&
        state.tabStopIssueId.board === issue.id),
  );
  const focusRequest = useIssueKeyboardStore((state) => state.focusRequest);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useLayoutEffect(() => {
    const requestedKey = focusRequest?.occurrenceKey ?? focusRequest?.issueId;
    const matchesOccurrence = requestedKey === keyboardOccurrenceKey;
    const matchesIssue =
      focusRequest?.issueId === issue.id && bucket?.groupBy !== "label";
    if (
      focusRequest?.scope !== "board" ||
      (!matchesOccurrence && !matchesIssue) ||
      !cardRef.current
    ) {
      return;
    }
    cardRef.current.focus({ preventScroll: true });
    cardRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [bucket?.groupBy, focusRequest, issue.id, keyboardOccurrenceKey]);

  const style = {
    ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
    ...(transition ? { transition } : {}),
  };

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

  const card = (
    <KanbanCardSurface
      ref={setCardRef}
      style={style}
      {...sortableListeners}
      {...sortableAttributes}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() =>
        useIssueKeyboardStore
          .getState()
          .focusOccurrence("board", keyboardOccurrenceKey, issue.id)
      }
      className={cn(
        focused && "border-brand-focus/60 bg-brand-fill/5",
        isOver &&
          !isDragging &&
          "border-brand-focus/60 ring-2 ring-brand-focus/20",
        isFlashing && "reef-flash-card",
      )}
      role="button"
      tabIndex={readOnlyReason || focused || tabStopped ? 0 : -1}
      aria-selected={focused || undefined}
      data-shortcut-surface="issue-kanban-card"
      data-occurrence-key={keyboardOccurrenceKey}
      data-keyboard-focused={focused ? "true" : undefined}
      pendingFields={pendingFields}
      updateMessage={updateMessage}
      issue={issue}
      currentLogin={currentLogin}
      blocked={blocked}
      planningCatalog={planningCatalog}
      isDragging={isDragging}
      reorderState={reorderState}
      reorderSuccess={reorderSuccess}
      readOnlyReason={readOnlyReason}
      readOnlyTooltipId={
        readOnlyReason ? `kanban-read-only-${keyboardOccurrenceKey}` : undefined
      }
      quickEditAnchor={
        vault ? (
          <IssueQuickEditAnchor
            scope="board"
            issue={issue}
            vault={vault}
            occurrenceKey={keyboardOccurrenceKey}
          />
        ) : undefined
      }
    />
  );

  return vault ? (
    <IssueContextMenu
      issue={issue}
      vault={vault}
      currentLogin={currentLogin}
      planningCatalog={planningCatalog}
      assignees={assignees}
    >
      {card}
    </IssueContextMenu>
  ) : (
    card
  );
});

function KanbanCardWithUpdateState(props: KanbanCardProps) {
  const fieldNames = useFieldNameLabels();
  const quickEdit = useTranslations("issues.quickEdit");
  const update = useIssueUpdateState(props.vault ?? "", props.issue.id);
  const quickEditFields = [
    { patchField: "status", label: fieldNames.status },
    { patchField: "priority", label: fieldNames.priority },
    { patchField: "assigned_to", label: fieldNames.assignee },
    { patchField: "labels", label: fieldNames.labels },
  ] as const;
  const updatedQuickEditFields = quickEditFields.filter(({ patchField }) =>
    update.fields.includes(patchField),
  );
  const pendingFields =
    update.status === "pending"
      ? updatedQuickEditFields.map(({ patchField }) => patchField)
      : [];
  const updateFieldLabels = updatedQuickEditFields.map(({ label }) => label);
  const updateMessage =
    updateFieldLabels.length > 0
      ? update.status === "pending"
        ? quickEdit("fieldUpdating", { field: updateFieldLabels.join(", ") })
        : update.status === "success"
          ? quickEdit("fieldUpdated", { field: updateFieldLabels.join(", ") })
          : update.status === "error"
            ? quickEdit("fieldUpdateFailed", {
                field: updateFieldLabels.join(", "),
              })
            : ""
      : "";

  return (
    <KanbanCardContent
      {...props}
      pendingFields={pendingFields}
      updateMessage={updateMessage}
    />
  );
}

export const KanbanCard = memo(function KanbanCard(props: KanbanCardProps) {
  return props.vault ? (
    <KanbanCardWithUpdateState {...props} />
  ) : (
    <KanbanCardContent {...props} />
  );
});

export function KanbanCardPreview({
  issue,
  blocked,
  planningCatalog,
}: Omit<KanbanCardProps, "onClick">) {
  const currentLogin = useCurrentUserLogin();
  return (
    <KanbanCardSurface
      aria-hidden="true"
      issue={issue}
      currentLogin={currentLogin}
      blocked={blocked}
      planningCatalog={planningCatalog}
      className="pointer-events-none cursor-grabbing shadow-lg"
    />
  );
}
