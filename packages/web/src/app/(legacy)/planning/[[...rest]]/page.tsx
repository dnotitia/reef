import { LegacyRedirect } from "@/features/ui/components/LegacyRedirect";

/**
 * Backward-compat shim for the pre-REEF-315 flat `/planning` URLs (and any
 * sub-path). The optional catch-all matches the whole segment; LegacyRedirect
 * forwards to the vault-scoped `/workspace/{vault}/planning` route, preserving the
 * query. `force-dynamic` because the redirect reads the live URL at request
 * time and must never be statically prerendered.
 */
export const dynamic = "force-dynamic";

export default function LegacyPlanningPage() {
  return <LegacyRedirect />;
}
