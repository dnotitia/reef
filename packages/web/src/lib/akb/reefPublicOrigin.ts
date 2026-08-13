/**
 * The canonical external origin of THIS reef deployment (REEF-137).
 *
 * Server. should not reach the client (no `NEXT_PUBLIC_*`), and should not
 * be derived from `request.url` / `Host` / `X-Forwarded-Host`: those are
 * attacker-influenceable, and behind a TLS-terminating proxy they expose an
 * internal scheme/host/port that would not match akb's exact-origin allowlist.
 *
 * Reef-owned SSO uses this origin to form its exact OIDC callback and
 * post-logout redirect URIs. It is deployment-managed rather than inferred
 * from a request host. The returned value is canonical `scheme://host[:port]`
 * (host lowercased, default ports dropped).
 *
 * This compatibility normalizer returns null when unset. The mode-aware auth
 * runtime applies the stricter rule: `REEF_PUBLIC_ORIGIN` is required in SSO
 * mode. A malformed value always throws.
 */
export function getReefPublicOrigin(): string | null {
  const raw = process.env.REEF_PUBLIC_ORIGIN;
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "REEF_PUBLIC_ORIGIN must be an absolute origin URL, e.g. https://reef.example.com",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("REEF_PUBLIC_ORIGIN must use the http or https scheme");
  }
  // The OIDC authorization response returns to this origin, so require a
  // secure context except for loopback development.
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("REEF_PUBLIC_ORIGIN must use https for non-loopback hosts");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("REEF_PUBLIC_ORIGIN must not embed credentials");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(
      "REEF_PUBLIC_ORIGIN must be a bare origin with no path, query, or fragment",
    );
  }
  // `URL.origin` is the canonical `scheme://host[:port]`: host lowercased and
  // default ports (:443 for https, :80 for http) dropped.
  return url.origin;
}

/** Loopback / localhost hosts where plain http is acceptable for local dev. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
