import { SettingsTabs } from "@/features/settings/components/SettingsTabs";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";

/**
 * Shared shell for the scope-based Settings tabs (REEF-183). Owns the page
 * header and the top-level tab nav once; each tab route renders just its own
 * content into {children}. Keeping this a Server Component means the just client
 * JS the shell ships is the small {@link SettingsTabs} island.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* No workspace subtitle here, by design: unlike the vault-scoped pages
          (Issues / Planning / Activity / Reports), Settings surfaces the active
          workspace in its body — the Workspace tab's Active Workspace selector
          (REEF-174) — which both names and lets you switch it, so a header
          subtitle would be redundant (REEF-260). */}
      <PageHeader title="Settings" />
      <PageBody width="narrow" className="flex flex-col gap-6">
        <SettingsTabs />
        {children}
      </PageBody>
    </div>
  );
}
