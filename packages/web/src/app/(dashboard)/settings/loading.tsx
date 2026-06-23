import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI for the Settings tabs (REEF-255). Rendered inside the
 * settings layout (the page header and tab nav stay put) while a tab segment
 * fetches, so entering Settings or switching tabs shows a content skeleton
 * under the tabs instead of a blank panel.
 */
export default function Loading() {
  return (
    <div data-testid="settings-skeleton" className="flex flex-col gap-6">
      {/* screen-reader loading announcement (REEF-281). The settings layout owns the
          page header + tab nav, so this body skeleton carries the surface's one
          announcement. Sibling to the decorative groups, not under aria-hidden. */}
      <output className="sr-only">Loading…</output>
      <div className="flex flex-col gap-6" aria-hidden="true">
        {[0, 1].map((group) => (
          <div key={`group-${group}`} className="flex flex-col gap-3">
            <Skeleton tone="secondary" className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
