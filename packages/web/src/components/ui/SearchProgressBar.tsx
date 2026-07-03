import { cn } from "@/lib/utils";

interface SearchProgressBarProps {
  /**
   * True while an async search request is in flight. Renders nothing when
   * false, so an idle surface costs no DOM.
   */
  active: boolean;
  /**
   * Extra classes on the hairline container. The wired surfaces pin it to the
   * results' top edge with `top-0 bottom-auto` (or `sticky top-0` inside a
   * scrolling list); with no override it sits at the bottom edge.
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
 * positioned container; the wired surfaces pin it to the results' top edge
 * (`top-0 bottom-auto`, or `sticky top-0` inside a scrolling list) so the
 * indicator reads the same across every search surface (REEF-369).
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
