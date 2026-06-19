import { cn } from "@/lib/utils";

/**
 * Content-width presets for the scrollable region below a {@link PageHeader}.
 * - `full`   — no max-width; spans the content column (data tables, lists).
 * - `wide`   — `max-w-5xl`; multi-column dashboards (Reports).
 * - `narrow` — `max-w-2xl`; single-column reading / forms (Activity, Settings).
 */
type PageBodyWidth = "full" | "wide" | "narrow";

/**
 * Vertical rhythm presets.
 * - `comfortable` — `py-6`; reading, forms, dashboards.
 * - `compact`     — `py-4`; dense data tables.
 */
type PageBodyPad = "comfortable" | "compact";

const WIDTH_CLASS: Record<PageBodyWidth, string> = {
  full: "",
  wide: "max-w-5xl",
  narrow: "max-w-2xl",
};

const PAD_CLASS: Record<PageBodyPad, string> = {
  comfortable: "py-6",
  compact: "py-4",
};

interface PageBodyProps {
  /** Content-width preset. Defaults to `full`. */
  width?: PageBodyWidth;
  /** Vertical padding preset. Defaults to `comfortable`. */
  pad?: PageBodyPad;
  /** Applied to the inner centered container — use for `flex flex-col gap-*`. */
  className?: string;
  children: React.ReactNode;
}

/**
 * The scrollable body region of a dashboard page, sitting directly beneath
 * `PageHeader` (and an optional toolbar). Owns the single canonical source for
 * page-level horizontal padding (`px-6`), max-width centering, and vertical
 * rhythm so individual pages stop hand-rolling divergent `px-/py-/max-w-`
 * combinations.
 *
 * Renders a plain `<div>` (not `<main>`): `DashboardShell` already provides the
 * `<main>` landmark, so nesting another would be an invalid duplicate.
 *
 * Full-bleed canvases (Board kanban, Timeline grid) intentionally do NOT use
 * this — they manage their own internal padding and horizontal scroll.
 */
export function PageBody({
  width = "full",
  pad = "comfortable",
  className,
  children,
}: PageBodyProps) {
  return (
    // `overscroll-contain` keeps a scroll at the body's top/bottom edge from
    // chaining to the document, which would otherwise drag the fixed shell —
    // including the left sidebar — along on macOS trackpad/wheel overscroll.
    <div className="flex-1 overflow-auto overscroll-contain">
      <div
        className={cn(
          "mx-auto px-6",
          WIDTH_CLASS[width],
          PAD_CLASS[pad],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
