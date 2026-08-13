import { extractSsoSessionHandle } from "@/lib/akb/extractAkbSession";
import { buildClearedAuthCookies } from "@/lib/akb/sessionCookie";
import { readAuthRuntimeConfig } from "@/server/auth/config";
import { getSsoAuthRuntime } from "@/server/auth/runtime";

/** End the selected Reef auth session without returning any token material. */
export async function POST(request: Request): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }

  let mode: ReturnType<typeof readAuthRuntimeConfig>["mode"];
  try {
    mode = readAuthRuntimeConfig().mode;
  } catch {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503, headers },
    );
  }
  if (mode === "local") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const handle = extractSsoSessionHandle(request);
    await (await getSsoAuthRuntime()).sessions.logout(handle);
  } catch {
    // Missing/expired sessions are already logged out. Store failures still
    // clear the browser carrier and fail closed on the next request.
  }

  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ redirectUrl: "/api/auth/akb/sso/logout" }),
    { status: 200, headers },
  );
}
