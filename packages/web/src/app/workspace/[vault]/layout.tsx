import { WorkspaceGuard } from "@/features/ui/components/WorkspaceGuard";
// Read app version at build time from the root package.json.
// This is a Server Component so the import runs at build time on the server —
// safe and zero client-bundle cost.
import pkg from "../../../../../../package.json";

/**
 * WorkspaceLayout — wraps every `/workspace/[vault]` route with the
 * DashboardShell behind a WorkspaceGuard that gates the session, validates the
 * vault segment, and keeps the URL vault as the active workspace (REEF-315).
 */
export default function WorkspaceLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <WorkspaceGuard appVersion={pkg.version}>
      {children}
      {modal}
    </WorkspaceGuard>
  );
}
