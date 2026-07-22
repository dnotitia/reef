"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
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

/**
 * Shared sort control for the board, list, and backlog views (REEF-059). Mounted
 * once in the workspace header so every view reads the same `useIssueStore` sort
 * slot — a single mount structurally guarantees the "consistent across views"
 * contract rather than syncing parallel controls.
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
 * in one place; the backlog body carries the drag affordance (REEF-169 /
 * REEF-393).
 */
export function SortControl({
  supportsRankOrder = false,
  showsBacklogReorderHint = false,
}: SortControlProps) {
  // Granular selectors — does not subscribe to the whole store (web/AGENTS.md).
  const sortField = useIssueStore((s) => s.filter.sortField);
  const sortOrder = useIssueStore((s) => s.filter.sortOrder);
  const setSortField = useIssueStore((s) => s.setSortField);
  const setSortOrder = useIssueStore((s) => s.setSortOrder);
  const clearSort = useIssueStore((s) => s.clearSort);

  // Locale-resolved labels (REEF-292): the column names and the natural-language
  // direction copy. `directionLabel` keeps the same call shape it had as a core
  // function, so the render below is unchanged.
  const sortFieldLabels = useSortFieldLabels();
  const directionLabel = useDirectionLabel();

  // This control owns the words "Rank order"; the backlog body carries the
  // reorder affordance (REEF-169 / REEF-393).
  const t = useTranslations("issues.sort");
  const rankOrderLabel = t("rankOrder");

  // Derived during render — no effect, no mirrored state (you-might-not-need-an-effect).
  const isDefault = !sortField;
  // On rank-backed surfaces the pristine (no explicit sort) state IS the rank
  // order, shown as a real mode rather than a muted implicit default.
  const rankOrderActive = supportsRankOrder && isDefault;
  const effectiveField: UserSortField = sortField ?? DEFAULT_ISSUE_SORT_FIELD;
  const effectiveOrder = sortField
    ? (sortOrder ?? naturalSortOrder(sortField))
    : DEFAULT_ISSUE_SORT_ORDER;

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
      className={cn(
        "inline-flex h-8 items-center rounded-md border transition-colors duration-150",
        isDefault
          ? "border-border bg-elevated"
          : "border-brand bg-brand/10 ring-1 ring-brand/30",
      )}
      data-testid="sort-control"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-full items-center gap-1.5 px-2.5 text-[13px] transition-colors duration-150 hover:bg-surface-hover",
            // No direction toggle in rank order, so the trigger is fully rounded.
            rankOrderActive ? "rounded-md" : "rounded-l-md",
            // Muted for the board/list implicit default; rank order and
            // explicit sorts read as active foreground state.
            isDefault && !rankOrderActive
              ? "text-muted-foreground"
              : "text-foreground",
          )}
          data-testid="sort-control-trigger"
          aria-label={
            rankOrderActive
              ? t("orderAria", { label: rankOrderLabel })
              : t("sortAria", {
                  field: sortFieldLabels[effectiveField],
                  direction: directionLabel(effectiveField, effectiveOrder),
                })
          }
        >
          {rankOrderActive ? (
            <ListOrdered className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="font-medium">
            {rankOrderActive ? rankOrderLabel : sortFieldLabels[effectiveField]}
          </span>
          {!rankOrderActive && (
            <span className="text-muted-foreground">
              {directionLabel(effectiveField, effectiveOrder)}
            </span>
          )}
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="sort-control-content">
          <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {supportsRankOrder && (
            <DropdownMenuItem
              onSelect={() => clearSort()}
              data-testid="sort-option-rank"
              className="justify-between gap-6"
            >
              <span className="inline-flex items-center gap-2">
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    rankOrderActive ? "text-brand opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {rankOrderLabel}
              </span>
              {showsBacklogReorderHint ? (
                <span className="text-[11px] text-muted-foreground">
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
              className="justify-between gap-6"
            >
              <span className="inline-flex items-center gap-2">
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    sortField === field
                      ? "text-brand opacity-100"
                      : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {sortFieldLabels[field]}
              </span>
              <span className="text-[11px] text-muted-foreground">
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
        <button
          type="button"
          onClick={toggleDirection}
          className="inline-flex h-full items-center rounded-r-md border-l border-border-subtle px-2 text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
          data-testid="sort-direction-toggle"
          title={t("directionTitle", {
            direction: directionLabel(effectiveField, effectiveOrder),
          })}
          aria-label={t("toggleDirection")}
        >
          {effectiveOrder === "desc" ? (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}
