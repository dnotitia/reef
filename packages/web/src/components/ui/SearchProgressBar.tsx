import { cn } from "@/lib/utils";

interface SearchProgressBarProps {
  /**
   * True while an async search request is in flight. Renders nothing when
   * false, so an idle surface costs no DOM.
   */
  active: boolean;
  /**
   * Extra classes on the hairline container — e.g. to move it to a panel's top
   * edge (`top-0 bottom-auto`) instead of the default bottom edge.
   */
  className?: string;
}

/**
 * Indeterminate brand (teal) hairline shown along an async search surface's
 * input/panel edge while a request is in flight (REEF-369). Purely decorative
 * (`aria-hidden`): every wired surface keeps its own text / `aria-live` loading
 * signal, so this is a visual layer only and never a second screen-reader
 * announcement. Under reduced motion the sweep stops and a static brand bar
 * remains (see `.reef-search-progress` in globals.css), so the in-flight state
 * stays legible without movement.
 *
 * Teal only — the AI / chat surfaces own the purple streaming track and must
 * not use this (globals.css keeps teal↔purple separate). Place it inside a
 * `relative` container; it pins to the bottom edge by default.
 */
function SearchProgressBar({ active, className }: SearchProgressBarProps) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="search-progress-bar"
      className={cn(
        "reef-search-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden",
        className,
      )}
    />
  );
}

export { SearchProgressBar };
