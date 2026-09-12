import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAuthV2RouteRuntime } from "@/server/auth-v2/runtime";

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export async function POST(request: Request): Promise<Response> {
  const body = await readLogoutToken(request);
  if (!body) return new Response(null, { status: 400 });
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    const jwks = createRemoteJWKSet(
      new URL(`${runtime.config.transportUrl}/protocol/openid-connect/certs`),
      { timeoutDuration: 5_000 },
    );
    const { payload } = await jwtVerify(body, jwks, {
      algorithms: ["RS256"],
      issuer: runtime.config.issuer,
      audience: runtime.config.clientId,
      clockTolerance: 5,
    });
    const events = payload.events;
    if (
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      typeof payload.jti !== "string" ||
      !payload.jti ||
      typeof payload.sid !== "string" ||
      !payload.sid ||
      !events ||
      typeof events !== "object" ||
      !(BACKCHANNEL_EVENT in events)
    ) {
      return new Response(null, { status: 400 });
    }
    await runtime.store.revokeBySessionId(payload.sid);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 401 });
  } finally {
    await runtime?.close();
  }
}

async function readLogoutToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.text();
    return new URLSearchParams(form).get("logout_token");
  }
  try {
    const body: unknown = await request.json();
    return body &&
      typeof body === "object" &&
      "logout_token" in body &&
      typeof body.logout_token === "string"
      ? body.logout_token
      : null;
  } catch {
    return null;
  }
}
