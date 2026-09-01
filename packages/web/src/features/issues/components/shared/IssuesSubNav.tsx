"use client";

import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
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
      className="flex min-w-0 shrink-0 border-b border-border-subtle px-6 py-2"
    >
      <div className={cn(SEGMENTED_CONTROL_TRACK, "w-full max-w-md")}>
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
                SEGMENTED_CONTROL_ITEM,
                "min-w-0 flex-1 justify-center whitespace-nowrap text-center",
                isActive
                  ? SEGMENTED_CONTROL_ITEM_ACTIVE
                  : SEGMENTED_CONTROL_ITEM_INACTIVE,
              )}
            >
              {t(labelKey)}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
