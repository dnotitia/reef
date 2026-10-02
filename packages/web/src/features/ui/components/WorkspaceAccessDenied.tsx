"use client";

import { ReefMark } from "@/components/ui/reef-mark";
import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { InstallationActionControls } from "@/features/workspaceInstallation/components/InstallationActionControls";
import { useWorkspaceInstallationActions } from "@/features/workspaceInstallation/hooks/useWorkspaceInstallationActions";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import type {
  EnrichedVaultSummary,
  WorkspaceInstallationStatus,
} from "@reef/core";
import { useTranslations } from "next-intl";
import Link from "next/link";

interface WorkspaceAccessDeniedProps {
  /** The running Reef version shown by the shared account menu. */
  appVersion: string;
  /** The vault from the URL the signed-in user is blocked from accessing. */
  vault: string;
  /** The vaults the user CAN access, from `useVaults()`. */
  vaults: EnrichedVaultSummary[];
  installationStatus?: WorkspaceInstallationStatus;
  role?: string | null;
}

/**
 * Explicit "access denied for this workspace" surface (REEF-315 AC5). A
 * `/workspace/{vault}/...` URL whose `vault` is a well-formed name the
 * signed-in user is not a member of should not silently fall back to their own
 * workspace — that would open someone else's deep link in the wrong context.
 * Instead we name the problem and offer the user's own canonically ready Reef
 * workspaces as the way out, or a
 * path into onboarding when they have none.
 */
export function WorkspaceAccessDenied({
  appVersion,
  vault,
  vaults,
  installationStatus,
  role,
}: WorkspaceAccessDeniedProps) {
  const t = useTranslations("workspace.accessDenied");
  const reefVaults = vaults.filter((v) => v.installation_status === "ready");
  const canManage = role === "owner" || role === "admin";
  const hasInstallationState = installationStatus !== undefined;
  const body = hasInstallationState ? null : t("body", { vault });

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center bg-surface-page px-6 py-16"
      data-testid="workspace-access-denied"
    >
      <div
        className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6"
        data-testid="access-denied-account-menu"
      >
        <AccountMenu appVersion={appVersion} placement="utility" />
      </div>
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <ReefMark className="size-10" decorative />
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-lg font-semibold text-foreground">
            {t("title")}
          </h1>
          {body && <p className="text-sm text-muted-foreground">{body}</p>}
        </div>

        {installationStatus !== undefined && (
          <WorkspaceAvailability
            key={`${vault}:${installationStatus}:${canManage ? "manager" : "member"}`}
            vault={vault}
            initialStatus={installationStatus}
            canManage={canManage}
          />
        )}

        {reefVaults.length > 0 ? (
          <nav
            aria-label={t("switchHeading")}
            className="flex w-full flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle p-2 text-left"
          >
            <span className="px-2 py-1 type-card-metadata font-medium text-muted-foreground">
              {t("switchHeading")}
            </span>
            {reefVaults.map((v) => (
              <Link
                key={v.name}
                href={withVault(v.name, "/issues")}
                data-testid={`access-denied-workspace-${v.name}`}
                className={cn(
                  "truncate rounded-md px-2 py-1.5 type-navigation text-foreground transition-colors hover:bg-surface-hover",
                )}
              >
                {v.name}
              </Link>
            ))}
          </nav>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Link
              href="/onboarding"
              data-testid="access-denied-onboarding"
              className="rounded-md bg-brand-fill px-3 py-1.5 type-control font-medium text-brand-on-fill transition-colors hover:bg-brand-fill/90"
            >
              {t("onboardingCta")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceAvailability({
  vault,
  initialStatus,
  canManage,
}: {
  vault: string;
  initialStatus: WorkspaceInstallationStatus;
  canManage: boolean;
}) {
  const t = useTranslations("workspaceInstallation");
  const actions = useWorkspaceInstallationActions({
    vault,
    initialStatus,
    canManage,
  });
  const visibleStatus =
    !canManage && actions.status !== "ready"
      ? "management_required"
      : actions.status;

  return (
    <article
      className="flex w-full flex-col gap-3 rounded-md border border-border-subtle bg-surface-subtle/40 px-4 py-3 text-left"
      data-testid={`workspace-installation-${vault}`}
      data-status={visibleStatus}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="type-control font-medium text-foreground">{vault}</h2>
        <span className="type-caption text-muted-foreground">
          {t(`status.${visibleStatus}`)}
        </span>
      </div>
      <dl className="grid w-full grid-cols-1 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("label.impact")}</dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`impact.${visibleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("label.nextAction")}
          </dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`nextAction.${visibleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("label.responsible")}
          </dt>
          <dd className="mt-0.5 text-muted-foreground">
            {t(`responsible.${visibleStatus}`)}
          </dd>
        </div>
      </dl>
      <InstallationActionControls
        vault={vault}
        status={visibleStatus}
        canManage={canManage}
        busy={actions.busy}
        activity={actions.activity}
        acknowledgement={actions.acknowledgement}
        error={actions.error}
        onRunCommand={(mode) => void actions.runCommand(mode)}
        onCheckStatus={() => void actions.checkStatus()}
      />
      {canManage && (
        <Link
          href={withVault(vault, "/settings/workspace")}
          data-testid={`installation-diagnostics-link-${vault}`}
          className="type-small-button text-foreground underline decoration-border underline-offset-4 hover:text-brand-text"
        >
          {t("button.openDiagnostics")}
        </Link>
      )}
    </article>
  );
}
