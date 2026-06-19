import {
  PageShell,
  ReportsSkeleton,
} from "@/features/reports/components/ReportLayout";

/**
 * Route-level loading UI for /reports (REEF-255). Mirrors the page's own
 * pending state (PageShell + ReportsSkeleton) so a soft-nav into Reports shows
 * the KPI/card frame immediately instead of waiting on the segment fetch.
 */
export default function Loading() {
  return (
    <PageShell>
      <ReportsSkeleton />
    </PageShell>
  );
}
