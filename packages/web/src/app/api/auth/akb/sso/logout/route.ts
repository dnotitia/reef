import { buildClearedAuthCookies } from "@/lib/akb/sessionCookie";
import { readAuthRuntimeConfig } from "@/server/auth/config";
import { getSsoAuthRuntime } from "@/server/auth/runtime";

/** Navigate to the issuer-derived logout endpoint without an ID-token hint. */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  try {
    if (readAuthRuntimeConfig().mode !== "sso") {
      return Response.json(
        { error: "SSO route unavailable." },
        { status: 404, headers },
      );
    }
    headers.set("Location", (await getSsoAuthRuntime()).oidc.logoutLocation());
    return new Response(null, { status: 302, headers });
  } catch {
    headers.set("Location", "/login");
    return new Response(null, { status: 302, headers });
  }
}
