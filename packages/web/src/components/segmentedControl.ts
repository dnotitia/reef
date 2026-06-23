/**
 * Shared class vocabulary for the segmented-control family (REEF-261): the
 * bordered `bg-elevated` track with a `bg-surface-hover` active fill used by the
 * issue {@link ViewSwitcher}, the {@link SettingsTabs} navigation, and the
 * Planning kind toggle.
 *
 * The three controls diverge in element + ARIA semantics — two are
 * `<button aria-pressed>` toggle groups while Settings is a `<nav>` of
 * `<Link aria-current>` page links — so the family is shared as class tokens
 * rather than one wrapping component. Each consumer keeps its own element and
 * ARIA model but draws its dimensions and focus ring from this single source so
 * the family is unable to silently drift apart again (the divergence this issue
 * fixes). Consumers append their own layout-context classes (`self-start`,
 * `mb-4`) and any control-specific state (pending/`aria-busy`) via {@link cn}.
 *
 * Dimensions follow the canonical ViewSwitcher (`text-[12px]`, `px-2 py-1`); the
 * focus ring is the app-wide canonical `ring-brand`. ViewSwitcher previously
 * carried no focus-visible indicator at all (the a11y gap closed here).
 */

/** Bordered track wrapping the segments. */
export const SEGMENTED_CONTROL_TRACK =
  "inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-elevated p-0.5";

/** A single segment (button or link). Includes the canonical focus-visible ring. */
export const SEGMENTED_CONTROL_ITEM =
  "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/** Active-segment fill. */
export const SEGMENTED_CONTROL_ITEM_ACTIVE = "bg-surface-hover text-foreground";

/** Inactive-segment tone + hover. */
export const SEGMENTED_CONTROL_ITEM_INACTIVE =
  "text-muted-foreground hover:text-foreground";
