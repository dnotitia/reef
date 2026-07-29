import { ActivityFeedSkeleton } from "@/features/activity/components/ActivityFeed";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useTranslations } from "next-intl";

export default function SuggestionsLoading() {
  const suggestions = useTranslations("activity");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={suggestions("pageTitle")} />
      <PageBody width="narrow">
        <ActivityFeedSkeleton />
      </PageBody>
    </div>
  );
}
