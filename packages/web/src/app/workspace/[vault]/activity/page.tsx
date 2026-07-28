import { VAULT_NAME_RE } from "@/lib/akb/vaultName";
import { withVault } from "@/lib/workspaceHref";
import { notFound, redirect } from "next/navigation";

type LegacyActivitySearchParams = Record<string, string | string[] | undefined>;

export default async function LegacyWorkspaceActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ vault: string }>;
  searchParams: Promise<LegacyActivitySearchParams>;
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
  redirect(withVault(vault, `/suggestions${suffix}`));
}
