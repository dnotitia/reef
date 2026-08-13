import { readAuthRuntimeConfig } from "@/server/auth/config";
import { buildKeycloakLogoutLocation } from "@/server/auth/oidcClient";

/** Navigate to the issuer-derived logout endpoint without an ID-token hint. */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  try {
    const config = readAuthRuntimeConfig();
    if (config.mode !== "sso") {
      return Response.json(
        { error: "SSO route unavailable." },
        { status: 404, headers },
      );
    }
    headers.set("Location", buildKeycloakLogoutLocation(config));
    return new Response(null, { status: 302, headers });
  } catch {
    headers.set("Location", "/login");
    return new Response(null, { status: 302, headers });
  }
}
