import { LegacyRedirect } from "@/features/ui/components/LegacyRedirect";

/**
 * Backward-compat shim for the pre-REEF-315 flat `/activity` URLs (and any
 * sub-path). The optional catch-all matches the whole segment; LegacyRedirect
 * forwards to the vault-scoped `/workspace/{vault}/activity` route, preserving the
 * query. `force-dynamic` because the redirect reads the live URL at request
 * time and must never be statically prerendered.
 */
export const dynamic = "force-dynamic";

export default function LegacyActivityPage() {
  return <LegacyRedirect />;
}
