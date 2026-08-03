"use client";

import { NotificationInboxSkeleton } from "@/features/inbox/components/NotificationInbox";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { useTranslations } from "next-intl";

export default function InboxLoading() {
  const nav = useTranslations("nav");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={nav("inbox")} />
      <PageBody width="narrow">
        <NotificationInboxSkeleton />
      </PageBody>
    </div>
  );
}
