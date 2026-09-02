/**
 * Frozen chrome contract for every select / combobox control (REEF-135).
 *
 * Before this module, "pick one" controls were split across four primitives
 * (Radix Select, hand-rolled dropdown-menu, hand-rolled popover + bespoke
 * lists, cmdk) whose trigger height, list-item font, highlight token, and
 * chevron all diverged. These constants are the single source of truth for that
 * chrome so the `<Combobox>` primitive AND the surviving Radix `<Select>` render
 * pixel-identical triggers and option rows.
 *
 * Pure strings, no React — the same shape as `fieldKit.ts` (colors) and
 * FilterBar's local `TRIGGER_BASE`. Each conflicting axis resolves to ONE
 * winner, drawn from the existing design tokens:
 *   - trigger:    h-8 · border-border · bg-surface-elevated · type-control · hover:bg-surface-hover
 *   - active:     brand ring (filter "this is set" affordance)
 *   - chevron:    h-3.5 (14px) · text-muted-foreground · always present · rotates on open
 *   - option:     type-control · px-2 py-1.5 · bg-surface-hover highlight
 *   - selected:   trailing brand Check
 */

/** Field-style trigger (Assignee / Planning / Period / Scope / Status …). */
export const CBX_TRIGGER_FIELD =
  "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border " +
  "border-border bg-surface-elevated px-2.5 text-left type-control text-foreground " +
  "transition-colors duration-150 hover:bg-surface-hover " +
  "focus-visible:outline-none focus-visible:border-brand-focus focus-visible:ring-2 focus-visible:ring-brand-focus/30 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Action-style trigger (e.g. the Template apply button) — same height + hover. */
export const CBX_TRIGGER_BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-secondary px-3 " +
  "text-xs font-medium text-secondary-foreground transition-colors duration-150 " +
  "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/30 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Layered onto a field trigger when the control holds a non-default filter value. */
export const CBX_TRIGGER_ACTIVE = "border-brand-focus bg-brand-fill/10 ring-1 ring-brand-focus/30";

/**
 * Facet "chip" trigger (multi-select filter facets: Status / Type / Priority /
 * Severity / Due / Dependency). Unlike the field trigger its body is a short
 * label + " (N)" summary, not a value field, so it is auto-width and omits the
 * `w-full justify-between` of CBX_TRIGGER_FIELD. Selection state is layered via
 * the inactive/active tokens below.
 */
export const CBX_TRIGGER_CHIP =
  "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 type-control " +
  "transition-colors duration-150 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-brand-focus/30 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Chip with no active filter — muted label, like an unset combobox placeholder. */
export const CBX_TRIGGER_CHIP_INACTIVE =
  "border-border bg-surface-elevated text-muted-foreground hover:bg-surface-hover";

/** Chip holding a non-default facet selection. Reuses CBX_TRIGGER_ACTIVE's brand
 *  ring so a set facet and a set field combobox read identically; adds
 *  `text-foreground` to lift the label out of its inactive muted state. */
export const CBX_TRIGGER_CHIP_ACTIVE = `${CBX_TRIGGER_ACTIVE} text-foreground`;

/** Trailing chevron. Rotates 180° on open via the `data-[open=true]` attribute. */
export const CBX_CHEVRON =
  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 " +
  "data-[open=true]:rotate-180";

/**
 * Portaled-free panel shell. The shared Popover owns the top/bottom anchor.
 */
export const CBX_PANEL =
  "z-50 rounded-md border border-border " +
  "bg-surface-popover p-1 shadow-lg shadow-foreground/5 outline-none " +
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95";

/** Positioning for the non-portaled combobox panel. */
export const CBX_PANEL_POSITIONED = "absolute w-full min-w-[12rem]";

export const CBX_LIST = "max-h-64 overflow-y-auto overscroll-contain";

/**
 * Base option chrome (no layout — callers supply the row layout via
 * optionClassName). `pr-7` reserves the selection gutter on EVERY row — selected
 * or not — so the trailing `CBX_CHECK` (absolutely positioned, out of flow) never
 * competes with right-aligned caller meta (`@login`, planning status badge) and
 * primary-label truncation can't jump when a row becomes selected (REEF-144).
 */
export const CBX_OPTION_BASE =
  "relative w-full min-w-0 cursor-default rounded-sm pl-2 pr-7 py-1.5 text-left type-control " +
  "text-foreground transition-colors duration-150 hover:bg-surface-hover";

/** Default single-line row layout. */
export const CBX_OPTION_ROW = "flex items-center gap-2";

/** Radix menu highlight state, shared by context-menu option rows. */
export const CBX_OPTION_HIGHLIGHT =
  "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground " +
  "focus-visible:bg-surface-hover";

/** Muted "none" row (Unassigned / Any sprint). */
export const CBX_OPTION_MUTED = "text-muted-foreground";

/**
 * Selected-state check, pinned in the `CBX_OPTION_BASE` `pr-7` gutter. Absolute
 * (not `ml-auto`) so it sits in its own right rail outside the content flex flow
 * — it never shares a line with the caller's right-aligned meta (REEF-144).
 */
export const CBX_CHECK =
  "pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-text";

/** In-panel search input (searchable comboboxes). */
export const CBX_SEARCH =
  "mb-1 h-8 w-full rounded-md border border-border bg-surface-elevated px-2.5 type-control " +
  "text-foreground outline-none transition-colors placeholder:text-muted-foreground " +
  "focus-visible:border-brand-focus focus-visible:ring-2 focus-visible:ring-brand-focus/30";

/** Empty / loading row text. */
export const CBX_EMPTY = "px-2 py-1.5 type-control text-muted-foreground";
