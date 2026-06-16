"use client";

/**
 * Shared single-select combobox primitive (REEF-135).
 *
 * One trigger + list + (optional) search + keyboard + chevron, so every "pick
 * one" field across issues / reports / planning / create shares the exact chrome
 * frozen in `comboboxChrome.ts`. Generalizes the hand-rolled popover combos
 * (Assignee / Planning / Template) that previously each re-implemented their own
 * trigger, list, and highlight tokens.
 *
 * It is deliberately NOT built on cmdk: cmdk seizes its own input `id` /
 * `aria-labelledby`, which breaks the `<label htmlFor>` contract callers render.
 * Here the caller's `id` stays on the real focusable element. The panel is
 * absolutely positioned inside a `relative` root (same approach as popover.tsx)
 * rather than portaled, so a re-click on the trigger can't be mistaken for an
 * outside click (REEF-073) and a modal dialog's `pointer-events:none` never
 * reaches it (REEF-092).
 *
 * Data fetching stays with the caller (TanStack Query): the primitive renders
 * `options` + `loading` and reports keystrokes via `onQueryChange`.
 */

import {
  type PanelPlacement,
  computePanelPlacement,
  findScrollBoundaryRect,
} from "@/lib/panelPlacement";
import { scrollOptionIntoView } from "@/lib/scrollOptionIntoView";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CBX_CHECK,
  CBX_CHEVRON,
  CBX_EMPTY,
  CBX_LIST,
  CBX_OPTION_ACTIVE,
  CBX_OPTION_BASE,
  CBX_OPTION_MUTED,
  CBX_OPTION_ROW,
  CBX_PANEL,
  CBX_PANEL_ABOVE,
  CBX_PANEL_BELOW,
  CBX_SEARCH,
  CBX_TRIGGER_ACTIVE,
  CBX_TRIGGER_BUTTON,
  CBX_TRIGGER_FIELD,
} from "./comboboxChrome";

export interface ComboboxOption<T extends string> {
  value: T;
  /** Plain-text label — used for type-ahead, client-side filtering, and the
   *  default trigger display when no `renderValue` is given. */
  label: string;
  /** Extra text folded into client-side search matching. */
  keywords?: string;
  disabled?: boolean;
  /** Per-row `data-testid`. Shared with the multi-select sibling so a facet's
   *  `{facet}-option-{value}` test contract stays addressable across both. */
  testId?: string;
  /** The rendered row body (badge, avatar, …). The primitive adds the row
   *  chrome and the trailing selected check. */
  content: ReactNode;
}

interface ComboboxProps<T extends string> {
  value: T | null;
  onChange: (value: T | null) => void;
  options: ReadonlyArray<ComboboxOption<T>>;

  id?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  /** data-testid on the root wrapper. */
  testId?: string;
  /** data-testid on the trigger button. */
  triggerTestId?: string;

  disabled?: boolean;
  /** Filter affordance — paints the brand ring when a non-default value is set. */
  active?: boolean;
  loading?: boolean;

  placeholder?: ReactNode;
  /** Trigger display for the selected value (field variant). Falls back to the
   *  matched option's label. */
  renderValue?: (value: T) => ReactNode;
  triggerVariant?: "field" | "button";
  /** Full trigger body override (button variant / custom). Disables the chevron. */
  triggerContent?: ReactNode;

  searchable?: boolean;
  /** Immediate keystrokes — wire to a debounced server search. When omitted and
   *  `searchable` is set, the primitive filters `options` client-side. */
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;

  /** Leading "none" row (Unassigned / Any sprint); selecting it emits `null`. */
  noneOption?: { label: ReactNode };
  emptyState?: ReactNode;

  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
  /** Per-row layout override (e.g. two-line stacks). Defaults to a single line. */
  optionClassName?: string;
}

/** A rendered row: the optional "none" row carries `value: null`. */
type Row<T extends string> = {
  value: T | null;
  label: string;
  content: ReactNode;
  testId?: string;
  disabled: boolean;
  muted: boolean;
};

export function Combobox<T extends string>({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  ariaLabelledby,
  testId,
  triggerTestId,
  disabled,
  active,
  loading,
  placeholder,
  renderValue,
  triggerVariant = "field",
  triggerContent,
  searchable,
  onQueryChange,
  searchPlaceholder = "Search…",
  noneOption,
  emptyState,
  align = "start",
  className,
  contentClassName,
  optionClassName,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<PanelPlacement>({
    vertical: "down",
    horizontal: align,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ buffer: string; timer: number | null }>({
    buffer: "",
    timer: null,
  });

  const listId = useId();
  const isButton = triggerVariant === "button";

  // Client-side filter only when searchable AND the caller is not running its
  // own (server) search via onQueryChange.
  const visibleOptions = useMemo(() => {
    if (!searchable || onQueryChange) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, searchable, onQueryChange, query]);

  const optionRows = useMemo<Array<Row<T>>>(
    () =>
      visibleOptions.map((o) => ({
        value: o.value,
        label: o.label,
        content: o.content,
        testId: o.testId,
        disabled: o.disabled ?? false,
        muted: false,
      })),
    [visibleOptions],
  );

  // The clear / "none" row is hidden while actively searching, so Enter on a
  // query commits the first real match — never the leading clear row, which
  // would silently unset a persisted value (assignee / requester).
  const showNoneRow =
    Boolean(noneOption) && (!searchable || query.trim() === "");

  const rows = useMemo<Array<Row<T>>>(() => {
    const noneRows: Array<Row<T>> =
      showNoneRow && noneOption
        ? [
            {
              value: null,
              label:
                typeof noneOption.label === "string" ? noneOption.label : "",
              content: noneOption.label,
              disabled: false,
              muted: true,
            },
          ]
        : [];
    // The clear row is local; keep it usable above the skeleton. The async
    // option rows are dropped while loading so a stale/hidden row can never be
    // committed by Enter.
    return [...noneRows, ...(loading ? [] : optionRows)];
  }, [optionRows, showNoneRow, noneOption, loading]);

  // Emptiness is measured from the real options, not `rows` (which may still
  // carry the clear row), so configured empty-state copy stays reachable.
  const showEmptyState = !loading && optionRows.length === 0;

  const selectableCount = rows.filter((r) => !r.disabled).length;
  // -1 means "no active row" — used when a non-null value is absent from the
  // loaded option page, so a bare Enter can't commit (and clear) anything.
  const clampedActive =
    activeIndex < 0 || rows.length === 0
      ? -1
      : Math.min(activeIndex, rows.length - 1);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    onQueryChange?.("");
  }, [onQueryChange]);

  const openPanel = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    // Highlight the current selection. When a non-null value is missing from the
    // loaded option page (e.g. an assignee outside the capped result set), start
    // with NO active row so a bare Enter can't commit the clear row and wipe the
    // field — the user must navigate or search to change it.
    const idx = rows.findIndex((r) => r.value === value);
    setActiveIndex(idx >= 0 ? idx : value !== null ? -1 : 0);
  }, [disabled, rows, value]);

  const commitRow = useCallback(
    (row: Row<T> | undefined) => {
      if (!row || row.disabled) return;
      onChange(row.value);
      close();
      triggerRef.current?.focus();
    },
    [onChange, close],
  );

  // Outside-click close, keyed off the whole root (trigger + panel) so a
  // re-click on the trigger toggles closed instead of close-then-reopen
  // (REEF-073). Mousedown matches the popover.tsx contract.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // Focus the search input when a searchable panel opens.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Keep the active row in view as ↑/↓ moves past the capped-height list.
  // Scroll only the list (never `scrollIntoView`, which would drag the issue
  // detail sheet that anchors this non-portaled panel — REEF-145).
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[clampedActive] as
      | HTMLElement
      | undefined;
    scrollOptionIntoView(listRef.current, node);
  }, [open, clampedActive]);

  // Flip the (non-portaled) panel's anchor on open so it stays on screen rather
  // than being clipped by — or dragging — the surrounding sheet (REEF-145).
  // Measured in a layout effect so the chosen corner paints without a jump, and
  // re-measured when async options resize the panel (rows) or the preferred
  // horizontal side (align) changes.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement({ vertical: "down", horizontal: align });
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    const boundary = findScrollBoundaryRect(triggerRef.current);
    const next = computePanelPlacement({
      trigger,
      panel: { width: panel.width, height: panel.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      boundary: boundary ?? undefined,
      preferredHorizontal: align,
    });
    setPlacement((prev) =>
      prev.vertical === next.vertical && prev.horizontal === next.horizontal
        ? prev
        : next,
    );
  }, [open, align, rows.length]);

  const moveActive = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      setActiveIndex((current) => {
        // From "no active row" (-1), ArrowDown lands on the first row and
        // ArrowUp on the last.
        let next = current < 0 ? (delta > 0 ? -1 : 0) : current;
        for (let step = 0; step < rows.length; step++) {
          next = (next + delta + rows.length) % rows.length;
          if (!rows[next]?.disabled) return next;
        }
        return current < 0 ? 0 : current;
      });
    },
    [rows],
  );

  // First-letter type-ahead for non-searchable selects (mirrors native <select>).
  const onTypeahead = useCallback(
    (char: string) => {
      const ta = typeahead.current;
      if (ta.timer) window.clearTimeout(ta.timer);
      ta.buffer += char.toLowerCase();
      const match = rows.findIndex(
        (r) => !r.disabled && r.label.toLowerCase().startsWith(ta.buffer),
      );
      if (match >= 0) setActiveIndex(match);
      ta.timer = window.setTimeout(() => {
        ta.buffer = "";
      }, 600);
    },
    [rows],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (!open) openPanel();
          else moveActive(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (!open) openPanel();
          else moveActive(-1);
          break;
        case "Home":
          if (open) {
            e.preventDefault();
            setActiveIndex(0);
          }
          break;
        case "End":
          if (open) {
            e.preventDefault();
            setActiveIndex(rows.length - 1);
          }
          break;
        case "Enter":
          if (open) {
            // Trap Enter inside the combobox (no form submit). `rows` already
            // excludes the async option rows while loading and the clear row
            // while searching, and clampedActive is -1 when the current value
            // isn't in the loaded page — so Enter only ever commits a visible row.
            e.preventDefault();
            if (clampedActive >= 0) commitRow(rows[clampedActive]);
          }
          break;
        case "Escape":
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            close();
            triggerRef.current?.focus();
          }
          break;
        case " ":
          // The non-searchable trigger keeps focus on the button, so a bare
          // Space would fire its native click and close the menu. While open,
          // commit the active row like Enter and suppress that click; while
          // closed, let the native click open the panel. (Searchable combos keep
          // focus in the text input, where Space must type normally.)
          if (!searchable && open) {
            e.preventDefault();
            if (clampedActive >= 0) commitRow(rows[clampedActive]);
          }
          break;
        default:
          // Type-ahead only when the focus is on the button (no text input).
          if (
            !searchable &&
            open &&
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey
          ) {
            onTypeahead(e.key);
          }
      }
    },
    [
      open,
      openPanel,
      moveActive,
      rows,
      clampedActive,
      commitRow,
      close,
      searchable,
      onTypeahead,
    ],
  );

  const activeRowId =
    open && clampedActive >= 0
      ? `${listId}-row-${clampedActive}`
      : undefined;

  const triggerBody =
    triggerContent ??
    (value !== null && selectedOption ? (
      (renderValue?.(value) ?? (
        <span className="truncate">{selectedOption.label}</span>
      ))
    ) : value !== null ? (
      (renderValue?.(value) ?? <span className="truncate">{value}</span>)
    ) : (
      <span className="truncate text-muted-foreground">{placeholder}</span>
    ));

  return (
    <div
      ref={rootRef}
      data-testid={testId}
      // Close when keyboard focus (Tab) leaves the combobox entirely — the
      // mousedown-outside handler only covers pointer dismissal. relatedTarget
      // is the element gaining focus; null or outside-root means we tabbed away.
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      className={cn(
        isButton ? "relative inline-block" : "relative w-full",
        className,
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        data-testid={triggerTestId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={!searchable && open ? activeRowId : undefined}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={handleKeyDown}
        className={cn(
          isButton ? CBX_TRIGGER_BUTTON : CBX_TRIGGER_FIELD,
          !isButton && active && CBX_TRIGGER_ACTIVE,
        )}
      >
        {triggerBody}
        {!isButton && !triggerContent && (
          <ChevronDown data-open={open} className={CBX_CHEVRON} />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className={cn(
            CBX_PANEL,
            placement.vertical === "up" ? CBX_PANEL_ABOVE : CBX_PANEL_BELOW,
            placement.horizontal === "end" ? "right-0" : "left-0",
            contentClassName,
          )}
        >
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeRowId}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
                onQueryChange?.(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              className={CBX_SEARCH}
            />
          )}

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            className={CBX_LIST}
          >
            {rows.map((row, index) => {
                const selected = row.value === value;
                const isActive = index === clampedActive;
                return (
                  // Options are buttons (not a role=listbox/option tree): the
                  // trigger/search input owns ↑/↓ + Enter, buttons are kept out
                  // of the tab order (tabIndex -1). Mirrors the lint-clean
                  // pattern already used by IssueRelationInput / AssigneeCombobox.
                  <button
                    key={row.value ?? "__none"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={row.disabled || undefined}
                    tabIndex={-1}
                    id={`${listId}-row-${index}`}
                    data-testid={row.testId}
                    disabled={row.disabled}
                    data-active={isActive}
                    // Keep focus on the trigger/search input so the row's click
                    // fires before the outside-mousedown handler.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commitRow(row)}
                    className={cn(
                      CBX_OPTION_BASE,
                      optionClassName ?? CBX_OPTION_ROW,
                      row.muted && CBX_OPTION_MUTED,
                      isActive && CBX_OPTION_ACTIVE,
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    {row.content}
                    {selected && <Check className={CBX_CHECK} aria-hidden />}
                  </button>
              );
            })}
            {loading && <p className={CBX_EMPTY}>Loading…</p>}
            {showEmptyState && (
              <p className={CBX_EMPTY}>{emptyState ?? "No results."}</p>
            )}
          </div>
        </div>
      )}

      {/* Screen-reader count for searchable result lists. */}
      {searchable && (
        <span aria-live="polite" className="sr-only">
          {open && query.trim()
            ? `${selectableCount} ${selectableCount === 1 ? "result" : "results"}`
            : ""}
        </span>
      )}
    </div>
  );
}
