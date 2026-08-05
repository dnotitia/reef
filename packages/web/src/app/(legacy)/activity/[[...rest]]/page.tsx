import { LegacyRedirect } from "@/features/ui/components/LegacyRedirect";

/**
 * Flat-route entry for older flat `/activity` URLs (and any sub-path). The
 * optional catch-all matches the whole segment; LegacyRedirect forwards
 * through the vault-scoped redirect route, preserving the query;
 * that route finishes at `/workspace/{vault}/suggestions`. `force-dynamic`
 * because the redirect reads the live URL at request time and should stay out
 * of static prerendering.
 */
export const dynamic = "force-dynamic";

export default function LegacyActivityPage() {
  return <LegacyRedirect />;
}
