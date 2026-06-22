import { BoardColumnsSkeleton } from "@/components/BoardColumnsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * Placeholder widths (in `w-*` units) for the filter-bar chips, in source order.
 * The first six mirror the auto-width facet chips (Status / Type / Priority /
 * Severity / Due / Dependency — each hugs a short label), then the six value
 * fields (Assignee / Requester / Sprint / Milestone / Release / Labels) sit at
 * the shared `9rem` (`w-36`) floor, and Display closes the row. Reproducing the
 * real chip count and widths in the same `flex flex-wrap gap-2` container makes
 * the skeleton wrap to the same number of rows as the live FilterBar at any
 * width, so the toolbar holds its height when the real bar hydrates (REEF-258).
 */
const FILTER_CHIPS = [
  { key: "status", width: "w-20" },
  { key: "type", width: "w-16" },
  { key: "priority", width: "w-20" },
  { key: "severity", width: "w-20" },
  { key: "due", width: "w-14" },
  { key: "dependency", width: "w-24" },
  { key: "assignee", width: "w-36" },
  { key: "requester", width: "w-36" },
  { key: "sprint", width: "w-36" },
  { key: "milestone", width: "w-36" },
  { key: "release", width: "w-36" },
  { key: "labels", width: "w-36" },
  { key: "display", width: "w-24" },
] as const;

/**
 * First-paint skeleton for the issues workspace, shared by the route's
 * `loading.tsx` (soft-nav segment fetch) and the page's `<Suspense fallback>`
 * (the `useSearchParams` CSR bail-out on a hard navigation / refresh / deep
 * link). Without a fallback that boundary renders `null`, so the body painted
 * blank until hydration — the gap REEF-255 closes.
 *
 * A cold hit carries no `?view=`, so this mirrors the default Board view: the
 * same {@link BoardColumnsSkeleton} the live board shows while pending
 * (REEF-097), so the route fallback and the hydrated pending state read
 * identically. The header + toolbar bar hold their heights so the real chrome
 * does not shove the board down when it hydrates in.
 *
 * The toolbar placeholder mirrors {@link IssueFilterToolbar}'s two rows — a
 * full-width SearchBar (`h-9`) over the wrapping FilterBar facet chips (`h-8`)
 * — so the toolbar does not grow ~50–90px and push the board down on hydration
 * (REEF-258). It does not vary the body by `?view=`: a server `loading.tsx` and
 * the CSR-bail Suspense fallback both render before the URL's view is known, so
 * the list/timeline/backlog frames stay a separate, deferred concern.
 */
export function IssuesWorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="issues-skeleton">
      {/* sr-only loading announcement (REEF-281). Sibling to the decorative body
          so it is NOT under aria-hidden; PageHeader's h1 stays a real heading. */}
      <output className="sr-only">Loading…</output>
      <PageHeader title="Issues" />
      {/* The placeholder body is decorative: aria-hidden keeps assistive tech
          from traversing the empty toolbar/board DOM. The wrapper inherits the
          column's flex sizing so the board still fills the remaining height. */}
      <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
        {/* Mirrors IssueFilterToolbar's outer bar (border-b · px-6 · py-2.5) and
            its SearchBar-over-FilterBar two-row stack so the toolbar appearing on
            hydration is not a vertical jump. */}
        <div
          className="flex flex-col gap-2 border-b border-border-subtle bg-background px-6 py-2.5"
          data-testid="issues-skeleton-toolbar"
        >
          {/* SearchBar row (Input h-9, full width). */}
          <Skeleton tone="secondary" className="h-9 w-full" />
          {/* FilterBar row — the wrapping facet/value chips (each h-8). */}
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_CHIPS.map((chip) => (
              <Skeleton
                key={chip.key}
                tone="secondary"
                className={`h-8 ${chip.width}`}
              />
            ))}
          </div>
        </div>
        <BoardColumnsSkeleton className="flex-1 overflow-hidden" />
      </div>
    </div>
  );
}
