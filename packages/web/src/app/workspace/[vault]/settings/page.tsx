import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { withVault } from "@/lib/workspaceHref";
import { notFound, redirect } from "next/navigation";

/**
 * /workspace/[vault]/settings has no content of its own — it is the scope-tab
 * section root (REEF-183). Redirect to the default Workspace tab so a bare
 * settings hit (bookmark, old link, sidebar nav) lands on a real tab page. The
 * redirect runs server-side, so there is no client flash of an empty shell.
 *
 * This server redirect runs before the client `WorkspaceGuard`, so it must apply
 * the same malformed-vault 404 itself — otherwise `withVault` would return a
 * bare path for an invalid segment and redirect into the legacy shim instead of
 * the promised hard 404 (REEF-315 AC5).
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ vault: string }>;
}) {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) notFound();
  redirect(withVault(vault, "/settings/workspace"));
}
