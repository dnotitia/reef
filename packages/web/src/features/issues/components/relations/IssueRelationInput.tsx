"use client";

import { IssueOptionRow } from "@/components/fields/IssueOptionRow";
import { Button } from "@/components/ui/button";
import {
  type IssueRelationLike,
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import { rankIssueOptions } from "@/features/issues/lib/rankIssueOptions";
import { computePanelPlacement } from "@/lib/panelPlacement";
import { scrollOptionIntoView } from "@/lib/scrollOptionIntoView";
import { cn } from "@/lib/utils";
import type { IssueListItem } from "@reef/core";
import { Check, Plus, X } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** Mirrors the shared `<Input>` chrome so the combobox field reads as a plain
 *  text input (the dropdown supplies the richer affordances). */
const INPUT_CLASS =
  "flex h-8 flex-1 min-w-0 rounded-md border border-border bg-elevated px-2.5 py-1 text-[13px] text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50";

/** How many candidates to surface before the user has typed anything. */
const RECENT_LIMIT = 8;

/** A complete reef-id shape (`PREFIX-NUMBER`), distinct from a title/prefix search. */
const ID_LIKE = /^[a-z]+-\d+$/i;

interface IssueRelationInputProps {
  id: string;
  label: string;
  value: readonly string[];
  allIssues: readonly IssueListItem[];
  /**
   * Whole-vault relation graph (reef_id / status / depends_on) for the blocked
   * badge. Defaults to `allIssues`, but callers should pass the relations
   * projection (`useIssueRelations`) so a dependency on an archived done/closed
   * issue — absent from the displayed list — isn't miscounted as a blocker.
   */
  relationGraph?: readonly IssueRelationLike[];
  currentIssueId?: string;
  onChange: (value: string[]) => void;
  disabled?: boolean;
  maxItems?: number;
  /** Suppress the internal label when an external `<label>` already labels it. */
  hideLabel?: boolean;
}

/** A dropdown row is either a real candidate or the free-text "Use …" affordance. */
type Option =
  | { kind: "issue"; issue: IssueListItem }
  | { kind: "use"; id: string };

/**
 * Issue-relation combobox (REEF-032). Replaces the native `<datalist>` with a
 * small self-owned listbox so each candidate renders as a card-level
 * `IssueOptionRow` (status · id · title · type · priority · blocked) and the
 * keyboard works (↑/↓ to move, Enter to add, Esc to close).
 *
 * It is intentionally hand-rolled rather than built on cmdk: cmdk forces its own
 * input `id` / `aria-labelledby`, which breaks the caller's `id` contract and the
 * `<label htmlFor={id}>` rendered by callers (e.g. NewIssueDialog). Owning the
 * input keeps `id` on the real focusable element so labels associate normally.
 *
 * Free-text entry is preserved: typing an id that matches no candidate surfaces a
 * "Use …" row so Enter / the button still add an arbitrary id. When candidates DO
 * match, Enter and the button commit the highlighted/top match — does not the raw
 * query — so a title or prefix search does not store an invalid relation id.
 *
 * Single mode (`maxItems === 1`) keeps the chosen id in the field with a
 * Set/Clear button; multi mode renders removable chips plus an Add button.
 */
export function IssueRelationInput({
  id,
  label,
  value,
  allIssues,
  relationGraph,
  currentIssueId,
  onChange,
  disabled = false,
  maxItems,
  hideLabel = false,
}: IssueRelationInputProps) {
  const listId = useId();
  const isSingle = maxItems === 1;
  const selectedSingleValue = value[0] ?? "";
  const [draft, setDraft] = useState(isSingle ? selectedSingleValue : "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Focus stays on the input (aria combobox pattern), so keep the highlighted
  // row in view manually when ↑/↓ moves past the capped-height list.
  const listRef = useRef<HTMLDivElement>(null);
  // The dropdown is portaled to <body> with fixed positioning so it overlays
  // (rather than being clipped by) the scrollable dialogs these fields live in.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is anchored from its top (opening down) or its bottom (flipped up),
  // does not both, plus a list height cap so a long candidate list scrolls inside
  // the panel instead of running off-screen.
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Position the portaled panel relative to the field: at least as wide as the
  // input but does not narrower than 20rem (so the rich rows stay readable in narrow
  // columns) and clamped within the viewport horizontally. Vertically it opens
  // downward by default but flips up when the field sits near the viewport bottom
  // (REEF-223) — the panel is `position: fixed`, so it is not clipped by the
  // dialog and the viewport is the just boundary. The list height is capped to the
  // room available in the chosen direction (does not past the 256px design max).
  const updateCoords = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - 8 - width),
    );

    // Decide up vs down from the measured panel. An unmeasured panel (width 0 —
    // jsdom, or the frame before first paint) keeps the default downward anchor.
    const panelRect = panelRef.current?.getBoundingClientRect();
    const { vertical } = computePanelPlacement({
      trigger: rect,
      panel: { width: panelRect?.width ?? 0, height: panelRect?.height ?? 0 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      margin,
    });

    const panelPadding = 8; // p-1 (top + bottom) around the list
    const room =
      vertical === "up"
        ? rect.top - margin - 8
        : window.innerHeight - rect.bottom - margin - 8;
    // Cap to the room available in the chosen direction (does not past the 256px
    // design max) and does not force a floor larger than that room — otherwise a
    // flipped panel in a short viewport (e.g. mobile keyboard open) would render
    // taller than the space above the field and run offscreen (REEF-223). When
    // room is genuinely tiny the list just becomes a smaller scroll area.
    const maxHeight = Math.min(256, Math.max(0, room - panelPadding));

    const next =
      vertical === "up"
        ? {
            bottom: window.innerHeight - rect.top + margin,
            left,
            width,
            maxHeight,
          }
        : { top: rect.bottom + margin, left, width, maxHeight };

    // Idempotent: bail when nothing changed so a scroll/resize re-measure that
    // lands on the same placement doesn't trigger a needless re-render.
    setCoords((prev) =>
      prev &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next,
    );
  }, []);

  const candidates = useMemo(
    () => allIssues.filter((issue) => issue.id !== currentIssueId),
    [allIssues, currentIssueId],
  );
  // Built once over the whole-vault relation graph (fallback: the candidate
  // list) so each visible row resolves its blocker count in O(1) instead of
  // rebuilding the dependency map per row.
  const blockedIndex = useMemo(
    () => indexIssuesById(relationGraph ?? allIssues),
    [relationGraph, allIssues],
  );

  const inputValue = isSingle && !open ? selectedSingleValue : draft;
  const trimmed = inputValue.trim();
  const normalizedDraft = trimmed.toUpperCase();
  const normalizedCurrentId = currentIssueId?.trim().toUpperCase() ?? null;

  const matches = useMemo<Array<{ issue: IssueListItem }>>(() => {
    const query = inputValue.trim();
    if (!query) {
      return candidates
        .filter((issue) => !issue.archived_at)
        .slice(0, RECENT_LIMIT)
        .map((issue) => ({ issue }));
    }
    return rankIssueOptions(candidates, query);
  }, [candidates, inputValue]);

  // Free-text affordance: an id-shaped query that is not already a VISIBLE match
  // (nor the current issue) gets a "Use …" row, so a relation id absent from the
  // list can be added by hand — including an archived issue, which
  // `rankIssueOptions` drops from `matches` even though it exists in
  // `candidates`. Gating on the id
  // shape (not `matches.length === 0`) keeps a plain title search from
  // masquerading as free-text.
  const showUseRow =
    ID_LIKE.test(normalizedDraft) &&
    normalizedDraft !== normalizedCurrentId &&
    !value.includes(normalizedDraft) &&
    !matches.some(({ issue }) => issue.id === normalizedDraft);

  // Does any visible match contain the typed text in its ID? A prefix search
  // ("REEF-0" → REEF-001) does; a complete id that appears in some other
  // issue's title ("REEF-900" → "Migrate REEF-900 …") does not. When it does
  // NOT, the typed id is the user's real intent, so the Use row leads (and is
  // the default Enter/button commit); otherwise the id matches lead.
  const hasIdMatch = matches.some(({ issue }) =>
    issue.id.includes(normalizedDraft),
  );
  const useRowIsPrimary = showUseRow && !hasIdMatch;

  const options = useMemo<Option[]>(() => {
    const issueOptions: Option[] = matches.map(({ issue }) => ({
      kind: "issue",
      issue,
    }));
    const useOption: Option[] = showUseRow
      ? [{ kind: "use", id: normalizedDraft }]
      : [];
    // Lead with whichever the typed text most likely means.
    return useRowIsPrimary
      ? [...useOption, ...issueOptions]
      : [...issueOptions, ...useOption];
  }, [matches, showUseRow, useRowIsPrimary, normalizedDraft]);

  const showPanel =
    open && !disabled && (options.length > 0 || trimmed.length > 0);
  const active = options.length
    ? Math.max(0, Math.min(activeIndex, options.length - 1))
    : 0;

  useEffect(() => {
    if (!showPanel) return;
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    // Scroll the list — does not `Element.scrollIntoView`, which walks up and
    // drags the surrounding dialog/sheet to reveal the row (REEF-223 / REEF-145).
    scrollOptionIntoView(listRef.current, row);
  }, [active, showPanel]);

  // Keep the portaled panel anchored to the field as ancestors scroll/resize.
  useEffect(() => {
    if (!showPanel) return;
    const reposition = () => updateCoords();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [showPanel, updateCoords]);

  // Anchor + flip the panel before paint, then keep it correct while it stays
  // open. The panel is consistently mounted while `showPanel` (no coords gate), so
  // `panelRef` is measured on this first pass and the vertical flip is decided
  // against real geometry in one go. A ResizeObserver re-measures whenever the
  // option list grows/shrinks the panel (e.g. broadening the query re-opens the
  // recent list), so a dropdown that opened downward still flips up / re-caps its
  // height instead of spilling off the viewport (REEF-223). A layout effect so the
  // chosen corner paints without a jump; idempotent `updateCoords` keeps the
  // re-measure from looping.
  useLayoutEffect(() => {
    if (!showPanel) return;
    updateCoords();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateCoords());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [showPanel, updateCoords]);

  // Let the candidate list scroll inside a modal dialog. The panel is portaled to
  // <body>, outside the dialog's `react-remove-scroll` lock — and that lock
  // cancels every wheel event whose target is outside it, scrollable or not. Its
  // handler runs on `document` in the bubble phase, so stopping the wheel event at
  // the panel keeps it from ever reaching that handler: the list then scrolls
  // natively while `overscroll-contain` still stops it chaining to the dialog
  // (REEF-223). Native (non-passive by default) listener so it fires before the
  // document handler regardless of React's synthetic event timing.
  useEffect(() => {
    if (!showPanel) return;
    const panel = panelRef.current;
    if (!panel) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    panel.addEventListener("wheel", stopWheel);
    return () => panel.removeEventListener("wheel", stopWheel);
  }, [showPanel]);

  // Close on a click outside the field and the (portaled) panel. A plain blur
  // handler does not see the panel, since it lives outside this component's DOM.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const singleValueChanged =
    normalizedDraft.length > 0 && normalizedDraft !== selectedSingleValue;

  // There is something to commit for a typed query that resolves to a real
  // match or a valid free-text id — does not the recent list (empty draft) or a
  // non-id, non-matching string like "foo". Gates both Enter and the button.
  const canCommit = trimmed.length > 0 && (matches.length > 0 || showUseRow);
  const isClearMode =
    isSingle && !singleValueChanged && Boolean(selectedSingleValue);
  const atMax = !isSingle && maxItems != null && value.length >= maxItems;

  function commit(idRaw: string) {
    const next = idRaw.trim().toUpperCase();
    // Guard every commit path (Use row, button, Enter) against a self-reference
    // and a duplicate; `candidates` already excludes the current issue from matches.
    if (!next || next === normalizedCurrentId || value.includes(next)) return;
    if (isSingle) {
      onChange([next]);
      setDraft(next);
      setOpen(false);
    } else if (maxItems == null || value.length < maxItems) {
      onChange([...value, next]);
      setDraft("");
      setActiveIndex(0);
      // Close on select, matching single mode — without this the panel re-opens
      // the recent list and reads as "selection didn't take" (REEF-223).
      setOpen(false);
    }
  }

  function selectOption(option: Option) {
    commit(option.kind === "issue" ? option.issue.id : option.id);
  }

  /**
   * Set/Add button: commit the active option — the same one Enter would, and the
   * same one highlighted in the dropdown. `canCommit` keeps the button disabled
   * (so this is a no-op) for an empty field or a non-id, non-matching string.
   */
  function commitPreferred() {
    const option = options[active];
    if (option) selectOption(option);
  }

  function removeRelation(idToRemove: string) {
    onChange(value.filter((item) => item !== idToRemove));
    if (isSingle) setDraft("");
  }

  function clearSingleRelation() {
    onChange([]);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) =>
        options.length ? Math.min(i + 1, options.length - 1) : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // just commit on a typed query — does not on the recent list shown for an
      // empty field, which would persist an arbitrary relation from
      // focusing and pressing Enter (the Add/Set button is disabled here too).
      // The recent list stays selectable by mouse.
      if (showPanel && trimmed.length > 0 && options[active]) {
        e.preventDefault();
        selectOption(options[active]);
      }
    } else if (e.key === "Escape" && open) {
      // Close the dropdown without bubbling Escape up to a parent dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!hideLabel && (
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={id}
        >
          {label}
        </label>
      )}
      <div ref={wrapperRef}>
        <div className="flex gap-1.5">
          <input
            id={id}
            name={id}
            type="text"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={showPanel ? listId : undefined}
            aria-autocomplete="list"
            aria-label={hideLabel ? label : undefined}
            value={inputValue}
            onChange={(e) => {
              setDraft(e.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => {
              setDraft(inputValue);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            // Short enough to stay readable in a narrow column while still
            // showing the example id shape and ending with an ellipsis.
            placeholder="REEF-001 or title…"
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLASS}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={
              isClearMode
                ? `Clear ${label}`
                : isSingle
                  ? `Set ${label}`
                  : `Add ${label}`
            }
            // Clear is consistently available; Set/Add require something committable
            // (a match or a valid free-text id) so a non-id string does not be saved.
            disabled={disabled || (isClearMode ? false : !canCommit || atMax)}
            onClick={isClearMode ? clearSingleRelation : commitPreferred}
          >
            {isSingle ? (
              isClearMode ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {showPanel &&
          createPortal(
            <div
              ref={panelRef}
              data-testid="relation-dropdown-panel"
              // Keep focus on the input when an option is clicked, so the click's
              // onSelect fires before the outside-mousedown close handler runs.
              onMouseDown={(e) => e.preventDefault()}
              // The panel renders before it is measured (so `panelRef` exists for
              // the layout effect to measure) — hide it for that pre-paint frame so
              // it does not flashes at the wrong corner.
              style={{
                position: "fixed",
                top: coords?.top,
                bottom: coords?.bottom,
                left: coords?.left,
                width: coords?.width,
                visibility: coords ? undefined : "hidden",
              }}
              className={cn(
                // `pointer-events-auto` is load-bearing: when this field lives in
                // a modal Radix dialog (e.g. NewIssueDialog), the dialog's
                // DismissableLayer sets `pointer-events: none` on <body>, and this
                // panel — portaled to <body> — inherits it. Without re-enabling
                // pointer events, clicks pass through the panel: the option button's
                // onClick does not fires (no relation added) and the outside-mousedown
                // handler closes the dropdown instead. Inline (non-modal) surfaces
                // are unaffected but harmless to set.
                "pointer-events-auto z-[100] rounded-md border border-border bg-popover p-1 shadow-lg shadow-foreground/5",
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
              )}
            >
              {options.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No matching issues.
                </p>
              ) : (
                <div
                  ref={listRef}
                  id={listId}
                  // `overscroll-contain` stops wheel-scroll from chaining to the
                  // dialog/sheet; `maxHeight` caps the list to the room available
                  // in the chosen direction so it does not spills off-screen
                  // (REEF-223). `max-h-64` is the unmeasured fallback.
                  style={{ maxHeight: coords?.maxHeight }}
                  className="max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain"
                >
                  {options.map((option, index) => {
                    const isActive = index === active;
                    // Options are buttons (not a role="listbox"/"option" tree): the
                    // input owns ↑/↓ navigation + Enter, buttons are kept out of the
                    // tab order (tabIndex -1), and this matches the lint-clean dropdown
                    // pattern already used by AssigneeCombobox.
                    if (option.kind === "use") {
                      return (
                        <button
                          key="__use"
                          type="button"
                          tabIndex={-1}
                          onClick={() => selectOption(option)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground touch-manipulation",
                            isActive && "bg-accent text-accent-foreground",
                          )}
                        >
                          <Plus
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            Use <span className="font-mono">{option.id}</span>
                          </span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={option.issue.id}
                        type="button"
                        tabIndex={-1}
                        data-issue-id={option.issue.id}
                        onClick={() => selectOption(option)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left touch-manipulation",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                      >
                        <IssueOptionRow
                          issue={option.issue}
                          query={inputValue}
                          blockerCount={unresolvedBlockerCountIn(
                            option.issue,
                            blockedIndex,
                          )}
                          selected={
                            isSingle && option.issue.id === selectedSingleValue
                          }
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>,
            document.body,
          )}
      </div>

      {/* Screen-reader hint for the live result count. */}
      <span aria-live="polite" className="sr-only">
        {showPanel && trimmed.length > 0
          ? `${matches.length} matching ${matches.length === 1 ? "issue" : "issues"}`
          : ""}
      </span>

      {!isSingle && value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((relationId) => (
            <span
              key={relationId}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground"
            >
              <span className="font-mono">{relationId}</span>
              <button
                type="button"
                aria-label={`Remove ${relationId}`}
                disabled={disabled}
                onClick={() => removeRelation(relationId)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
