"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const ISSUE_SUB_NAV_ITEMS = [
  { href: "/issues", id: "issue-list", labelKey: "list" },
  {
    href: "/issues/changes",
    id: "change-review",
    labelKey: "changeReview",
  },
] as const;

/**
 * Addressable navigation within the Issues surface. The links are real routes,
 * so the selected segment follows the URL and retains normal link behavior
 * (back/forward, deep links, and open in a new tab).
 */
export function IssuesSubNav() {
  const pathname = usePathname();
  const { vault } = useActiveVault();
  const t = useTranslations("issues.navigation");
  if (!vault) return null;

  const issueListHref = withVault(vault, "/issues");
  const changeReviewHref = withVault(vault, "/issues/changes");
  const isChangeReview =
    pathname === changeReviewHref ||
    pathname.startsWith(`${changeReviewHref}/`);

  // Native anchors force the static changes route to load. Next Link's soft
  // navigation also matches the sibling dynamic issue-id interceptor, which
  // would leave the Issues workspace mounted underneath a null modal slot.
  return (
    <nav
      aria-label={t("ariaLabel")}
      data-testid="issues-subnav"
      className="inline-flex w-fit max-w-full min-w-0 shrink-0 flex-wrap items-center gap-4 border-b border-border-subtle px-6 py-2"
    >
      {ISSUE_SUB_NAV_ITEMS.map(({ href, id, labelKey }) => {
        const fullHref = withVault(vault, href);
        const isActive =
          id === "change-review"
            ? isChangeReview
            : !isChangeReview &&
              (pathname === issueListHref ||
                pathname.startsWith(`${issueListHref}/`));
        return (
          <a
            key={id}
            href={fullHref}
            aria-current={isActive ? "page" : undefined}
            data-testid={`issues-subnav-${id}`}
            className={cn(
              "-mb-px min-w-0 shrink-0 whitespace-nowrap border-b-2 px-0.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
              isActive
                ? "border-brand-focus text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(labelKey)}
            {isActive && <span className="sr-only"> ({t("currentPage")})</span>}
          </a>
        );
      })}
    </nav>
  );
}
