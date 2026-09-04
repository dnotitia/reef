"use client";

import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenu,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isManualOrdering,
  useIssueStore,
} from "@/features/issues/stores/useIssueStore";
import { useDirectionLabel, useSortFieldLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ISSUE_SORT_FIELD,
  DEFAULT_ISSUE_SORT_ORDER,
  USER_SORT_FIELDS,
} from "@reef/core";
import { type UserSortField, naturalSortOrder } from "@reef/core/fields";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ListOrdered,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

// Module-level: a stable reference, does not recreated per render.
const SORT_OPTIONS = USER_SORT_FIELDS;

interface SortControlProps {
  /**
   * Surfaces reef's issue-wide `rank` order as the pristine state instead of
   * the board/list Priority default (REEF-129 / REEF-393).
   */
  supportsRankOrder?: boolean;
  /**
   * On backlog, rank order is also user-editable via drag reorder, so the
   * dropdown can carry that extra affordance without changing the order label.
   */
  showsBacklogReorderHint?: boolean;
}

interface SortControlTriggerProps {
  rankOrderActive: boolean;
  isDefault: boolean;
  rankOrderLabel: string;
  sortFieldLabel: string;
  direction: string;
  ariaLabel: string;
  summaryLabel?: string;
}

function SortControlTrigger({
  rankOrderActive,
  isDefault,
  rankOrderLabel,
  sortFieldLabel,
  direction,
  ariaLabel,
  summaryLabel,
}: SortControlTriggerProps) {
  const { open } = useDropdownMenu();

  return (
    <DropdownMenuTrigger
      className={cn(
        CBX_TRIGGER_CHIP,
        rankOrderActive || !isDefault
          ? CBX_TRIGGER_CHIP_ACTIVE
          : CBX_TRIGGER_CHIP_INACTIVE,
        rankOrderActive
          ? "shrink-0 whitespace-nowrap rounded-md"
          : "shrink-0 whitespace-nowrap rounded-l-md rounded-r-none border-r-0",
      )}
      data-testid="sort-control-trigger"
      aria-label={ariaLabel}
    >
      {rankOrderActive ? (
        <ListOrdered className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="font-medium">
        {summaryLabel ?? (rankOrderActive ? rankOrderLabel : sortFieldLabel)}
      </span>
      {!rankOrderActive && (
        <span className="text-muted-foreground">{direction}</span>
      )}
      <ChevronDown
        data-open={open ? "true" : "false"}
        aria-hidden="true"
        className={CBX_CHEVRON}
      />
    </DropdownMenuTrigger>
  );
}

/**
 * Shared sort control for the board, list, and backlog views (REEF-059). Mounted
 * once in the shared filter toolbar so every view reads the same
 * `useIssueStore` sort slot — a single mount structurally guarantees the
 * "consistent across views" contract rather than syncing parallel controls.
 *
 * Pristine-default behavior (REEF-057): with no explicit user choice the control
 * *displays* the default sort (Priority · High → Low) in a muted state but does
 * NOT write it to the store, keeping the URL / persisted filter slot clean. The
 * first field pick or direction toggle promotes the default to an explicit
 * selection.
 *
 * On the backlog and board (`supportsRankOrder`), the same pristine state
 * instead reads as the active Rank order — meaningful, not muted — and the
 * dropdown offers it as a first-class option. That keeps the order vocabulary
 * in one place; the backlog Rank header carries the guidance while the row
 * grip carries the drag affordance (REEF-169 / REEF-393).
 */
export function SortControl({
  supportsRankOrder = false,
  showsBacklogReorderHint = false,
}: SortControlProps) {
  // Granular selectors — does not subscribe to the whole store (web/AGENTS.md).
  const sortField = useIssueStore((s) => s.filter.sortField);
  const sortOrder = useIssueStore((s) => s.filter.sortOrder);
  const orderingMode = useIssueStore((s) => s.filter.orderingMode);
  const setSortField = useIssueStore((s) => s.setSortField);
  const setSortOrder = useIssueStore((s) => s.setSortOrder);
  const clearSort = useIssueStore((s) => s.clearSort);

  // Locale-resolved labels (REEF-292): the column names and the natural-language
  // direction copy. `directionLabel` keeps the same call shape it had as a core
  // function, so the render below is unchanged.
  const sortFieldLabels = useSortFieldLabels();
  const directionLabel = useDirectionLabel();

  // This control owns the words "Rank order"; the backlog Rank header carries
  // the reorder guidance (REEF-169 / REEF-393).
  const t = useTranslations("issues.sort");
  const rankOrderLabel = t("rankOrder");

  // Derived during render — no effect, no mirrored state (you-might-not-need-an-effect).
  // On rank-backed surfaces the shared Manual state is a real mode rather than
  // an implicit field default. Legacy filters with no orderingMode resolve to
  // Manual until a field is selected.
  const rankOrderActive =
    supportsRankOrder &&
    isManualOrdering({ sortField, sortOrder, orderingMode });
  const isDefault = !sortField && !rankOrderActive;
  const effectiveField: UserSortField = sortField ?? DEFAULT_ISSUE_SORT_FIELD;
  const effectiveOrder = sortField
    ? (sortOrder ?? naturalSortOrder(sortField))
    : DEFAULT_ISSUE_SORT_ORDER;
  const effectiveDirection = directionLabel(effectiveField, effectiveOrder);
  const sortIsActive = rankOrderActive || !isDefault;
  // Radix owns pointer hover/open timing. Keeping a second pointer flag here
  // races its delayed open callback; focus is the only local pin needed to
  // keep the tooltip visible through a keyboard or pointer click.
  const directionFocusedRef = useRef(false);
  const [directionTooltipOpen, setDirectionTooltipOpen] = useState(false);

  // Picking a field lands on its intuitive direction; the toggle flips from there.
  const selectField = (field: UserSortField) => {
    setSortField(field);
    setSortOrder(naturalSortOrder(field));
  };

  // Toggling from the implicit default first promotes it to an explicit choice,
  // so an orphaned order can not silently flip the default sort.
  const toggleDirection = () => {
    if (isDefault) setSortField(DEFAULT_ISSUE_SORT_FIELD);
    setSortOrder(effectiveOrder === "asc" ? "desc" : "asc");
  };

  return (
    <div
      className="inline-flex shrink-0 items-stretch"
      data-testid="sort-control"
    >
      <DropdownMenu>
        <SortControlTrigger
          rankOrderActive={rankOrderActive}
          isDefault={isDefault}
          rankOrderLabel={rankOrderLabel}
          sortFieldLabel={sortFieldLabels[effectiveField]}
          direction={effectiveDirection}
          ariaLabel={
            rankOrderActive
              ? t("orderAria", { label: rankOrderLabel })
              : t("sortAria", {
                  field: sortFieldLabels[effectiveField],
                  direction: effectiveDirection,
                })
          }
          summaryLabel={
            showsBacklogReorderHint && rankOrderActive
              ? t("sortSummary", { label: rankOrderLabel })
              : undefined
          }
        />
        <DropdownMenuContent align="start" data-testid="sort-control-content">
          <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {supportsRankOrder && (
            <DropdownMenuItem
              onSelect={() => clearSort()}
              data-testid="sort-option-rank"
              aria-current={rankOrderActive ? "true" : undefined}
              selected={rankOrderActive}
              className="justify-between gap-6"
            >
              <span className="inline-flex items-center gap-2">
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    rankOrderActive
                      ? "text-brand-text opacity-100"
                      : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {rankOrderLabel}
              </span>
              {showsBacklogReorderHint ? (
                <span className="type-caption text-muted-foreground">
                  {t("drag")}
                </span>
              ) : null}
            </DropdownMenuItem>
          )}
          {SORT_OPTIONS.map((field) => (
            <DropdownMenuItem
              key={field}
              onSelect={() => selectField(field)}
              data-testid={`sort-option-${field}`}
              aria-current={sortField === field ? "true" : undefined}
              selected={sortField === field}
              className="justify-between gap-6"
            >
              <span className="inline-flex items-center gap-2">
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    sortField === field
                      ? "text-brand-text opacity-100"
                      : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {sortFieldLabels[field]}
              </span>
              <span className="type-caption text-muted-foreground">
                {directionLabel(
                  field,
                  sortField === field
                    ? effectiveOrder
                    : naturalSortOrder(field),
                )}
              </span>
            </DropdownMenuItem>
          ))}
          {/* On rank-backed surfaces the named order option IS the reset, so the
              separate "Reset to default" item is redundant and omitted there. */}
          {!supportsRankOrder && !isDefault ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => clearSort()}
                data-testid="sort-reset"
                className="gap-2 text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t("resetToDefault")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Rank-backed pristine orders have no user-controlled asc/desc, so the
          direction toggle is hidden in those modes. */}
      {!rankOrderActive && (
        <TooltipProvider>
          <Tooltip
            open={directionTooltipOpen}
            disableHoverableContent
            onOpenChange={(nextOpen) => {
              if (nextOpen || !directionFocusedRef.current) {
                setDirectionTooltipOpen(nextOpen);
              }
            }}
          >
            <TooltipTrigger
              asChild
              onFocus={() => {
                directionFocusedRef.current = true;
              }}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  directionFocusedRef.current = false;
                  setDirectionTooltipOpen(false);
                }
              }}
            >
              <button
                type="button"
                onClick={toggleDirection}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-r-md border border-l-0 px-2.5 type-control transition-colors duration-150 hover:bg-surface-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
                  sortIsActive
                    ? "border-brand-focus bg-brand-fill/10 text-foreground ring-1 ring-brand-focus/30"
                    : "border-border bg-surface-elevated text-muted-foreground",
                )}
                data-testid="sort-direction-toggle"
                title={t("directionTitle", { direction: effectiveDirection })}
                aria-label={t("toggleDirectionAria", {
                  direction: effectiveDirection,
                })}
              >
                {effectiveOrder === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {t("directionTitle", { direction: effectiveDirection })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
