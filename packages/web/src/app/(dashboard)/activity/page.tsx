"use client";

import { ActivityFeed } from "@/features/activity/components/ActivityFeed";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * Activity Page — renders ActivityFeed for recent auto-updates.
 */
export default function ActivityPage() {
  const { vault, isLoading } = useActiveVault();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Activity" description={vault || undefined} />
      <PageBody width="narrow">
        {!vault && !isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Configure a workspace in{" "}
            <a href="/settings" className="text-brand underline">
              Settings
            </a>{" "}
            to get started.
          </p>
        ) : (
          <ActivityFeed vault={vault} />
        )}
      </PageBody>
    </div>
  );
}
