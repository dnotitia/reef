import { IssuesWorkspaceSkeleton } from "@/features/issues/components/filters/IssuesWorkspaceSkeleton";

/**
 * Route-level loading UI for /issues (REEF-255). Next.js renders this as the
 * segment's Suspense fallback during a soft-nav RSC fetch, so a sidebar click
 * swaps straight to the board skeleton instead of holding the previous page
 * with no destination feedback. Shares the skeleton with the page's own
 * `<Suspense fallback>` so soft and hard navigation read identically.
 */
export default function Loading() {
  return <IssuesWorkspaceSkeleton />;
}
