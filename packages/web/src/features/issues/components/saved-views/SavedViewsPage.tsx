"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSavedIssueViews } from "@/features/issues/hooks/queries/useSavedIssueViews";
import { useSavedIssueViewPreferences } from "@/features/issues/hooks/useSavedIssueViewPreferences";
import { savedIssueViewHref } from "@/features/issues/lib/issueViewCodec";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { withVault } from "@/lib/workspaceHref";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SavedViewActions } from "./SavedViewActions";

function ViewsPageSkeleton() {
  return (
    <div className="space-y-2" data-testid="saved-views-page-loading">
      {[0, 1, 2].map((index) => (
        <Skeleton
          key={index}
          className="h-14 w-full"
          style={{ "--i": index } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export function SavedViewsPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const query = useSavedIssueViews(vault);
  const preferences = useSavedIssueViewPreferences(
    vault,
    query.data,
    query.isSuccess && !query.isFetching,
  );
  const nav = useTranslations("nav");
  const t = useTranslations("issues.savedViews");
  const c = useTranslations("common");

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={nav("views")} description={vault || undefined} />
      {!vault && !vaultLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <PageBody width="wide" pad="compact">
          {vaultLoading || query.isPending || preferences.isLoading ? (
            <ViewsPageSkeleton />
          ) : query.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-sm text-destructive">
                {t("loadError")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                {c("retry")}
              </Button>
            </div>
          ) : query.data?.length ? (
            <ul
              className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-elevated"
              data-testid="saved-views-list"
            >
              {query.data.map((view) => {
                const isDefault = preferences.defaultId === view.id;
                const isFavorite = preferences.favoriteIds.includes(view.id);
                return (
                  <li
                    key={view.id}
                    className="group flex min-w-0 items-center gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={savedIssueViewHref(vault, view.payload)}
                          className="truncate text-[13px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          title={view.name}
                        >
                          {view.name}
                        </Link>
                        {isDefault ? (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-foreground">
                            {t("default")}
                          </span>
                        ) : null}
                        {isFavorite ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            <Star
                              className="size-2.5 fill-current"
                              aria-hidden="true"
                            />
                            {t("favorite")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("owner", { owner: view.owner })}
                      </p>
                    </div>
                    <SavedViewActions
                      vault={vault}
                      view={view}
                      preferences={preferences}
                      setDefault={preferences.setDefault}
                      setFavorite={preferences.setFavorite}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div
              className="rounded-lg border border-dashed border-border-subtle bg-surface-subtle px-6 py-16 text-center"
              data-testid="saved-views-empty"
            >
              <p className="text-sm font-medium text-foreground">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("emptyDescription")}
              </p>
              <Link
                href={withVault(vault, "/issues")}
                className="mt-4 inline-flex h-8 items-center rounded-md border border-border bg-elevated px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {t("createInIssues")}
              </Link>
            </div>
          )}
        </PageBody>
      )}
    </div>
  );
}
