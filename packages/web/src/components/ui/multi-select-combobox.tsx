"use client";

/**
 * Shared multi-select combobox primitive (REEF-140).
 *
 * The sibling of the single-select `<Combobox>`: it draws the exact same frozen
 * chrome from `comboboxChrome.ts` (option row, trailing brand Check, panel
 * shell, chevron) but runs a multi-select interaction model — `values: T[]`, a
 * toggle that keeps the panel open, and `role="menuitemcheckbox"` /
 * `aria-checked` rows. The two are deliberately NOT one component behind a mode
 * prop (surfaces compose leaves, they don't merge): single-select commits-and-
 * closes against a `T | null`; this one toggles-and-stays against a `T[]`.
 *
 * The trigger is an auto-width "chip" ("Status (2)") rather than a value field,
 * so it uses the chip trigger token, not `CBX_TRIGGER_FIELD`.
 *
 * Optionally searchable (REEF-267), mirroring the single-select primitive: pass
 * `searchable` to render a panel-top search input, and `onQueryChange` to wire it
 * to a debounced server search (omit it to filter `options` client-side). This is
 * what lets the people facets (assignee/requester) be both multi-select and
 * typeahead-searchable over vault members. A toggle keeps the panel — and the
 * current query — open so several picks accumulate without re-searching.
 *
 * Empty-array folding (`[] → undefined` for the URL / IndexedDB projection) is
 * the caller's filter-store concern: the primitive only reports each toggle via
 * `onToggle(value, checked)` and never owns that rule.
 *
 * Panel / dismissal behavior is inherited from the single-select primitive:
 * non-portaled panel anchored inside a `relative` root, so a modal dialog's
 * `pointer-events:none` can't reach it (REEF-092); outside-click keyed off the
 * whole root, so a trigger re-click toggles closed instead of close-then-reopen
 * (REEF-073); option rows `preventDefault` on mousedown so their click fires
 * before the outside handler and focus stays on the trigger.
 */

import {
  type PanelPlacement,
  computePanelPlacement,
  findScrollBoundaryRect,
} from "@/lib/panelPlacement";
import { scrollOptionIntoView } from "@/lib/scrollOptionIntoView";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
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
import type { ComboboxOption } from "./combobox";
import {
  CBX_CHECK,
  CBX_CHEVRON,
  CBX_EMPTY,
  CBX_LIST,
  CBX_OPTION_ACTIVE,
  CBX_OPTION_BASE,
  CBX_OPTION_ROW,
  CBX_PANEL,
  CBX_PANEL_ABOVE,
  CBX_PANEL_BELOW,
  CBX_SEARCH,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "./comboboxChrome";
import { SearchProgressBar } from "./SearchProgressBar";
import { useOverlayOpenRegistration } from "./overlayDismiss";

interface MultiSelectComboboxProps<T extends string> {
  /** Short facet label in the trigger ("Status"); the primitive appends the
   *  " (value)" / " (N)" selection summary. */
  label: string;
  /** Currently-selected values (undefined when the facet is unset). */
  values: readonly T[] | undefined;
  /** Reports a row toggle; the caller folds `[] → undefined` for its store. */
  onToggle: (value: T, checked: boolean) => void;
  options: ReadonlyArray<ComboboxOption<T>>;

  /** Filter affordance — paints the brand ring + foreground label when set. */
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;

  /** Render a panel-top search input (REEF-267). */
  searchable?: boolean;
  /** Immediate keystrokes — wire to a debounced server search. When omitted and
   *  `searchable` is set, the primitive filters `options` client-side. */
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  /** Shown when the (filtered) option list is empty and not loading. */
  emptyState?: ReactNode;

  ariaLabel?: string;
  /** data-testid on the trigger button. */
  triggerTestId?: string;
  /** data-testid on the panel. */
  contentTestId?: string;

  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
  /** Per-row layout override (defaults to the shared single-line row). */
  optionClassName?: string;
  /**
   * Render a single selected value in the trigger summary ("(value)"). Defaults
   * to the raw value, which reads fine for enum members and logins, but a
   * planning facet passes this to show the item name instead of its opaque id
   * (REEF-246/267). Two or more selections always collapse to "(N)".
   */
  summarizeValue?: (value: T) => string;
}

/** Short trigger suffix: " (value)" for one selection, " (N)" for many. The
 *  single-selection form runs `summarizeValue` so a caller can show a readable
 *  label (e.g. a planning name) instead of an opaque id. */
function facetSummary<T extends string>(
  values: readonly T[] | undefined,
  summarizeValue?: (value: T) => string,
): string {
  if (!values || values.length === 0) return "";
  if (values.length === 1) {
    const value = values[0];
    return ` (${summarizeValue ? summarizeValue(value) : value})`;
  }
  return ` (${values.length})`;
}

export function MultiSelectCombobox<T extends string>({
  label,
  values,
  onToggle,
  options,
  active,
  disabled,
  loading,
  searchable,
  onQueryChange,
  searchPlaceholder,
  emptyState,
  ariaLabel,
  triggerTestId,
  contentTestId,
  align = "start",
  className,
  contentClassName,
  optionClassName,
  summarizeValue,
}: MultiSelectComboboxProps<T>) {
  const t = useTranslations("components.combobox");
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("searchPlaceholder");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<PanelPlacement>({
    vertical: "down",
    horizontal: align,
  });

  // While open inside a Sheet/Dialog, defer Escape to this overlay so it closes
  // the panel rather than the surrounding sheet (REEF-288).
  useOverlayOpenRegistration(open);

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

  // Client-side filter only when searchable AND the caller is not running its
  // own (server) search via onQueryChange — mirrors the single-select primitive.
  const visibleOptions = useMemo(() => {
    if (!searchable || onQueryChange) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, searchable, onQueryChange, query]);

  // Async option rows are dropped while loading so a stale row can't be toggled
  // by Enter mid-fetch (mirrors the single-select primitive).
  const rows = loading ? [] : visibleOptions;

  const clampedActive =
    rows.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), rows.length - 1);

  const showEmptyState = !loading && visibleOptions.length === 0;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    onQueryChange?.("");
  }, [onQueryChange]);

  const openPanel = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(0);
  }, [disabled]);

  const toggleAt = useCallback(
    (index: number) => {
      const option = rows[index];
      if (!option || option.disabled) return;
      const checked = !(values?.includes(option.value) ?? false);
      onToggle(option.value, checked);
      // Stay open — multi-select accumulates across several toggles.
    },
    [rows, values, onToggle],
  );

  // Outside-click close, keyed off the whole root (trigger + panel) so a
  // re-click on the trigger toggles closed instead of close-then-reopen
  // (REEF-073). Mousedown matches the single-select / popover contract.
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
  // Scroll only the list (never `scrollIntoView`, which would drag an ancestor
  // scroll container that anchors this non-portaled panel — REEF-145).
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[clampedActive] as
      | HTMLElement
      | undefined;
    scrollOptionIntoView(listRef.current, node);
  }, [open, clampedActive]);

  // Match the single-select Combobox: the panel is non-portaled, so placement
  // must consider both the viewport and the nearest scroll/clipping ancestor.
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
        let next = current;
        for (let step = 0; step < rows.length; step++) {
          next = (next + delta + rows.length) % rows.length;
          if (!rows[next]?.disabled) return next;
        }
        return current;
      });
    },
    [rows],
  );

  // First-letter type-ahead, mirroring the single-select primitive — only when
  // there is no search input to type into.
  const onTypeahead = useCallback(
    (char: string) => {
      const ta = typeahead.current;
      if (ta.timer) window.clearTimeout(ta.timer);
      ta.buffer += char.toLowerCase();
      const match = rows.findIndex(
        (o) => !o.disabled && o.label.toLowerCase().startsWith(ta.buffer),
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
          // Toggle (don't commit-and-close) — multi-select stays open, and the
          // search query is preserved so further picks accumulate.
          if (open) {
            e.preventDefault();
            if (clampedActive >= 0) toggleAt(clampedActive);
          }
          break;
        case " ":
          // The trigger keeps focus on the button, so a bare Space would fire
          // its native click and close the menu. While open (and not typing in a
          // search input, where Space must type), toggle the active row and
          // suppress that click; while closed, let the native click open the
          // panel.
          if (open && !searchable) {
            e.preventDefault();
            if (clampedActive >= 0) toggleAt(clampedActive);
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
        default:
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
      rows.length,
      clampedActive,
      toggleAt,
      close,
      searchable,
      onTypeahead,
    ],
  );

  const activeRowId =
    open && clampedActive >= 0 ? `${listId}-row-${clampedActive}` : undefined;

  return (
    <div
      ref={rootRef}
      // Close when keyboard focus (Tab) leaves the combobox entirely — the
      // mousedown-outside handler only covers pointer dismissal.
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      className={cn("relative inline-block", className)}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        disabled={disabled}
        // No aria-label: the visible body is `{label}{facetSummary}` ("Status
        // (2)"), so the button's accessible name is computed from that text and
        // carries the selection summary. A static aria-label would pin the name
        // to "Status" and hide which filters are set from screen readers (the
        // old DropdownMenu trigger had no label, so the summary stayed audible).
        // `ariaLabel` still names the menu list below, where the summary is N/A.
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={!searchable && open ? activeRowId : undefined}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={handleKeyDown}
        className={cn(
          CBX_TRIGGER_CHIP,
          active ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
        )}
      >
        {label}
        {facetSummary(values, summarizeValue)}
        <ChevronDown data-open={open} className={CBX_CHEVRON} />
      </button>

      {open && (
        <div
          ref={panelRef}
          data-testid={contentTestId}
          className={cn(
            CBX_PANEL,
            placement.vertical === "up" ? CBX_PANEL_ABOVE : CBX_PANEL_BELOW,
            placement.horizontal === "end" ? "right-0" : "left-0",
            contentClassName,
          )}
        >
          {/* In-flight hairline at the panel's top edge. Only async consumers
              pass `loading` (searchable + onQueryChange), so client-filter
              comboboxes never flash it — REEF-369 AC4. */}
          <SearchProgressBar
            active={!!loading}
            className="top-0 bottom-auto rounded-t-md"
          />
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
              placeholder={resolvedSearchPlaceholder}
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
            role="menu"
            aria-label={ariaLabel ?? label}
            className={CBX_LIST}
          >
            {rows.map((option, index) => {
              const selected = values?.includes(option.value) ?? false;
              const isActive = index === clampedActive;
              return (
                // Rows are buttons kept out of the tab order (tabIndex -1); the
                // trigger / search input owns ↑/↓ + Enter/Space. Mirrors the
                // single-select primitive's lint-clean pattern.
                <button
                  key={option.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selected}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={-1}
                  id={`${listId}-row-${index}`}
                  data-testid={option.testId}
                  disabled={option.disabled}
                  data-active={isActive}
                  // Keep focus on the trigger / search input so the row's click
                  // fires before the outside-mousedown handler (and the panel
                  // stays open).
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => toggleAt(index)}
                  className={cn(
                    CBX_OPTION_BASE,
                    optionClassName ?? CBX_OPTION_ROW,
                    isActive && CBX_OPTION_ACTIVE,
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {option.content}
                  {selected && <Check className={CBX_CHECK} aria-hidden />}
                </button>
              );
            })}
            {loading && <p className={CBX_EMPTY}>{t("loading")}</p>}
            {showEmptyState && (
              <p className={CBX_EMPTY}>{emptyState ?? t("noResults")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
