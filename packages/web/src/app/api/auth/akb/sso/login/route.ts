import { buildClearedSsoStartCookie } from "@/lib/akb/sessionCookie";

/**
 * The delegated AKB login proxy is retired. Reef starts its own Authorization
 * Code + PKCE flow at `/api/auth/akb/sso/start` and does not call AKB's retired
 * browser-login or JWT-exchange routes.
 */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildClearedSsoStartCookie());
  return Response.json(
    { error: "SSO route retired." },
    { status: 410, headers },
  );
}
