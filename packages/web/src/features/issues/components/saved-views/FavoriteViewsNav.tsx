"use client";

import {
  isIssuesListPath,
  savedIssueViewHref,
  savedIssueViewIsActive,
} from "@/features/issues/lib/issueViewCodec";
import { cn } from "@/lib/utils";
import type { SavedIssueView } from "@reef/core";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function FavoriteViewsNav({
  vault,
  views,
  favoriteIds,
}: {
  vault: string;
  views: readonly SavedIssueView[];
  favoriteIds: readonly string[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("issues.savedViews");
  const favorites = views
    .filter((view) => favoriteIds.includes(view.id))
    .toSorted((a, b) => a.name_key.localeCompare(b.name_key));
  if (favorites.length === 0) return null;

  return (
    <section className="mt-4 min-w-0" data-testid="favorite-views-nav">
      <h2 className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("favorites")}
      </h2>
      <ul className="space-y-0.5">
        {favorites.map((view) => {
          const active =
            isIssuesListPath(pathname, vault) &&
            savedIssueViewIsActive(view.payload, searchParams);
          return (
            <li key={view.id}>
              <Link
                href={savedIssueViewHref(vault, view.payload)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  active
                    ? "bg-surface-hover font-medium text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
                title={view.name}
              >
                <Star
                  className="size-3.5 shrink-0 fill-current"
                  aria-hidden="true"
                />
                <span className="truncate">{view.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
