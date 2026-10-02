"use client";

import { AccountMenu } from "@/features/auth/components/AccountMenu";
import { WorkspaceInstallationSection } from "@/features/settings/components/WorkspaceInstallationSection";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function BlockedWorkspaceInstallationSettings({
  appVersion,
  vault,
}: {
  appVersion: string;
  vault: string;
}) {
  const navT = useTranslations("nav");
  const t = useTranslations("workspaceInstallation");

  return (
    <div
      className="flex min-h-screen flex-col bg-surface-page"
      data-testid="workspace-installation-diagnostics"
    >
      <PageHeader
        title={navT("settings")}
        description={vault}
        actions={<AccountMenu appVersion={appVersion} placement="utility" />}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        <PageBody width="narrow" className="flex flex-col gap-4">
          <Link
            href={withVault(vault, "/issues")}
            className="type-small-button text-foreground underline decoration-border underline-offset-4 hover:text-brand-text"
          >
            {t("button.returnToAccess")}
          </Link>
          <WorkspaceInstallationSection vault={vault} readOnly />
        </PageBody>
      </main>
    </div>
  );
}
