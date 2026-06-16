/**
 * The canonical external origin of THIS reef deployment (REEF-137).
 *
 * Server. should not reach the client (no `NEXT_PUBLIC_*`), and should not
 * be derived from `request.url` / `Host` / `X-Forwarded-Host`: those are
 * attacker-influenceable, and behind a TLS-terminating proxy they expose an
 * internal scheme/host/port that would not match akb's exact-origin allowlist.
 *
 * Used as the absolute callback origin reef hands akb when delegating Keycloak
 * SSO. akb delivers the post-login one-time code to an origin listed in its
 * `keycloak_post_login_allowed_origins` allowlist, so reef sends an absolute
 * callback on this origin to make the code return to reef instead of akb's own
 * SPA. The returned value is the canonical `scheme://host[:port]` — akb's
 * `_normalize_origin` form (host lowercased, default ports dropped) — which should
 * match the operator's allowlist entry character-for-character.
 *
 * Returns null when unset: reef then keeps the older same-site callback path,
 * so single-target and akb-SPA deployments are unaffected (opt-in). Throws
 * on a malformed value so a deploy typo fails fast instead of silently degrading
 * SSO to the akb host.
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
  // The post-login callback on this origin carries the one-time SSO code — a
  // credential exchangeable for an akb session — so the origin should be a secure
  // context. Permit plain http for loopback/localhost dev; any other host
  // should be https, or a production typo (http://reef.example.com) would have the
  // code transit in cleartext.
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
  // default ports (:443 for https, :80 for http) dropped, matching akb's
  // `_normalize_origin` for the no-default-port form the allowlist should use.
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
