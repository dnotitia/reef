import { ActivityFeedSkeleton } from "@/features/activity/components/ActivityFeed";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * Route-level loading UI for /activity (REEF-255). Holds the page chrome
 * (header + narrow body) around the feed skeleton the live feed already shows
 * while loading, so a soft-nav into Activity is never a blank panel.
 */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Activity" />
      <PageBody width="narrow">
        <ActivityFeedSkeleton />
      </PageBody>
    </div>
  );
}
