/**
 * SSO-first login opt-in (REEF-312).
 *
 * When set, the `/login` server component redirects straight to the akb/Keycloak
 * authorize flow on entry — no "Continue with workspace SSO" button click — for
 * deployments where SSO is the primary identity. It is a deploy-time,
 * server-side env (no `NEXT_PUBLIC_*`), and defaults OFF so single-target and
 * mixed password+SSO deployments keep today's button-first panel.
 *
 * Pure and exported so the opt-in branch is unit-testable without a request. The
 * auto-redirect still requires akb to report Keycloak enabled, so
 * turning this on in a non-SSO deployment is a safe no-op.
 */
export function ssoAutoRedirectEnabled(
  raw: string | undefined = process.env.REEF_SSO_AUTO_REDIRECT,
): boolean {
  return raw === "1" || raw === "true";
}
