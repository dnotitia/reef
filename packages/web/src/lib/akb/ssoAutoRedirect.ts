/**
 * Optional SSO-first login opt-in. The value is server-only and defaults off,
 * so a mixed password+SSO deployment keeps its explicit login panel.
 */
export function ssoAutoRedirectEnabled(
  raw: string | undefined = process.env.REEF_SSO_AUTO_REDIRECT,
): boolean {
  return raw === "1" || raw === "true";
}
