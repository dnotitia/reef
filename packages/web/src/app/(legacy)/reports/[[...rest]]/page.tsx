import { LegacyRedirect } from "@/features/ui/components/LegacyRedirect";

/**
 * Flat-route shim for the pre-REEF-315 flat `/reports` URLs (and any
 * sub-path). The optional catch-all matches the whole segment; LegacyRedirect
 * forwards to the vault-scoped `/workspace/{vault}/reports` route, preserving the
 * query. `force-dynamic` because the redirect reads the live URL at request
 * time and should stay out of static prerendering.
 */
export const dynamic = "force-dynamic";

export default function LegacyReportsPage() {
  return <LegacyRedirect />;
}
