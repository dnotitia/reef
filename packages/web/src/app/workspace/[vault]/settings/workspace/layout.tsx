import { ActiveWorkspaceSection } from "@/features/settings/components/ActiveWorkspaceSection";
import { WorkspaceSubNav } from "@/features/settings/components/WorkspaceSubNav";

/**
 * Workspace tab shell (REEF-183). The Active Workspace selector lives here — on
 * the Workspace tab just — because it scopes everything beneath it; the personal
 * Preferences tab and operator-managed Deployment tab are not workspace-scoped,
 * so they does not show it (AC2). The selector sits above the General/Members
 * sub-nav so the one selection governs both sub-views (AC3): switching workspace
 * re-scopes General settings and the Members list together.
 */
export default function WorkspaceSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ActiveWorkspaceSection />
      <div className="flex flex-col gap-6">
        <WorkspaceSubNav />
        {children}
      </div>
    </div>
  );
}
