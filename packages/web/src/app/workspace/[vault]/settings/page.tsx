import { withVault } from "@/lib/workspaceHref";
import { redirect } from "next/navigation";

/**
 * /workspace/[vault]/settings has no content of its own — it is the scope-tab
 * section root (REEF-183). Redirect to the default Workspace tab so a bare
 * settings hit (bookmark, old link, sidebar nav) lands on a real tab page. The
 * redirect runs server-side, so there is no client flash of an empty shell.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ vault: string }>;
}) {
  const { vault } = await params;
  redirect(withVault(vault, "/settings/workspace"));
}
