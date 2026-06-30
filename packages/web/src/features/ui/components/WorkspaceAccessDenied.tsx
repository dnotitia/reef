"use client";

import { ReefMark } from "@/components/ui/reef-mark";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import type { EnrichedVaultSummary } from "@reef/core";
import { useTranslations } from "next-intl";
import Link from "next/link";

interface WorkspaceAccessDeniedProps {
  /** The vault from the URL the signed-in user is blocked from accessing. */
  vault: string;
  /** The vaults the user CAN access, from `useVaults()`. */
  vaults: EnrichedVaultSummary[];
}

/**
 * Explicit "access denied for this workspace" surface (REEF-315 AC5). A
 * `/workspace/{vault}/...` URL whose `vault` is a well-formed name the
 * signed-in user is not a member of should not silently fall back to their own
 * workspace — that would open someone else's deep link in the wrong context.
 * Instead we name the problem and offer the user's own reef workspaces as the
 * way out (the same `has_reef_config` set the sidebar switcher lists), or a
 * path into onboarding when they have none.
 */
export function WorkspaceAccessDenied({
  vault,
  vaults,
}: WorkspaceAccessDeniedProps) {
  const t = useTranslations("workspace.accessDenied");
  const reefVaults = vaults.filter((v) => v.has_reef_config);

  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-background px-6"
      data-testid="workspace-access-denied"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <ReefMark className="size-10" decorative />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-lg font-semibold text-foreground">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("body", { vault })}
          </p>
        </div>

        {reefVaults.length > 0 ? (
          <nav
            aria-label={t("switchHeading")}
            className="flex w-full flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface p-2 text-left"
          >
            <span className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("switchHeading")}
            </span>
            {reefVaults.map((v) => (
              <Link
                key={v.name}
                href={withVault(v.name, "/issues")}
                data-testid={`access-denied-workspace-${v.name}`}
                className={cn(
                  "truncate rounded-md px-2 py-1.5 text-[13px] text-foreground transition-colors hover:bg-surface-hover",
                )}
              >
                {v.name}
              </Link>
            ))}
          </nav>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Link
              href="/onboarding"
              data-testid="access-denied-onboarding"
              className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-brand-foreground transition-colors hover:bg-brand/90"
            >
              {t("onboardingCta")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
