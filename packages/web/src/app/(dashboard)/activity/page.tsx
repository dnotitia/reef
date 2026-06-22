"use client";

import { ActivityFeed } from "@/features/activity/components/ActivityFeed";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
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
      {!vault && !isLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <PageBody width="narrow">
          <ActivityFeed vault={vault} />
        </PageBody>
      )}
    </div>
  );
}
