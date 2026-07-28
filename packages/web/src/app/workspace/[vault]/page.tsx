import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { withVault } from "@/lib/workspaceHref";
import { notFound, redirect } from "next/navigation";

type WorkspaceRootSearchParams = Record<string, string | string[] | undefined>;

/**
 * A vault-scoped workspace root has no view of its own. Validate the explicit
 * URL vault before building a destination, then send it to the Issues surface.
 * The destination remains inside the same `[vault]` layout so WorkspaceGuard
 * continues to own auth, membership, Reef configuration, and URL→Dexie sync.
 */
export default async function VaultWorkspaceRootPage({
  params,
  searchParams,
}: {
  params: Promise<{ vault: string }>;
  searchParams: Promise<WorkspaceRootSearchParams>;
}) {
  const { vault } = await params;
  if (!VAULT_NAME_RE.test(vault)) notFound();

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") {
      query.append(key, value);
      continue;
    }
    for (const item of value ?? []) query.append(key, item);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(withVault(vault, `/issues${suffix}`));
}
