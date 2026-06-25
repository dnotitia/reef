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
   * Backlog just: surface the manual `rank` order (REEF-129) as a first-class
   * entry in this control. Manual order IS the pristine (no explicit sort)
   * state, so the header control — not a second in-body label — owns the whole
   * "how is this list ordered" vocabulary across every view (REEF-169).
   */
  supportsManualOrder?: boolean;
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
 * On the backlog (`supportsManualOrder`), the same pristine state instead reads
 * as the active "Manual order" (rank) mode — meaningful, not muted — and the
 * dropdown offers it as a first-class option. That keeps the order vocabulary in
 * one place; the backlog body carries the drag affordance (REEF-169).
 */
export function SortControl({ supportsManualOrder = false }: SortControlProps) {
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

  // This control owns the words "Manual order" —
  // the backlog body no longer restates it (REEF-169).
  const t = useTranslations("issues.sort");
  const manualOrderLabel = t("manualOrder");

  // Derived during render — no effect, no mirrored state (you-might-not-need-an-effect).
  const isDefault = !sortField;
  // On the backlog the pristine (no explicit sort) state IS the manual rank
  // order, shown as a real mode rather than a muted implicit default.
  const manualActive = supportsManualOrder && isDefault;
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
            // No direction toggle in manual order, so the trigger is fully rounded.
            manualActive ? "rounded-md" : "rounded-l-md",
            // Muted for the board/list implicit default; manual order and
            // explicit sorts read as active foreground state.
            isDefault && !manualActive
              ? "text-muted-foreground"
              : "text-foreground",
          )}
          data-testid="sort-control-trigger"
          aria-label={
            manualActive
              ? t("orderAria", { label: manualOrderLabel })
              : t("sortAria", {
                  field: sortFieldLabels[effectiveField],
                  direction: directionLabel(effectiveField, effectiveOrder),
                })
          }
        >
          {manualActive ? (
            <ListOrdered className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="font-medium">
            {manualActive ? manualOrderLabel : sortFieldLabels[effectiveField]}
          </span>
          {!manualActive && (
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
          {supportsManualOrder && (
            <DropdownMenuItem
              onSelect={() => clearSort()}
              data-testid="sort-option-manual"
              className="justify-between gap-6"
            >
              <span className="inline-flex items-center gap-2">
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    manualActive ? "text-brand opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                {manualOrderLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t("drag")}
              </span>
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
          {/* On the backlog the Manual-order option IS the reset, so the separate
              "Reset to default" item is redundant and omitted there. */}
          {!supportsManualOrder && !isDefault ? (
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
      {/* Manual order has no user-controlled asc/desc (it is rank ascending), so
          the direction toggle is hidden in that mode. */}
      {!manualActive && (
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
