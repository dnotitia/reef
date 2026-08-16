import { extractSsoSessionHandle } from "@/lib/akb/extractAkbSession";
import { buildClearedAuthCookies } from "@/lib/akb/sessionCookie";
import { readAuthRuntimeConfig } from "@/server/auth/config";
import { getSsoAuthRuntime } from "@/server/auth/runtime";

/** End the selected Reef auth session without returning any token material. */
export async function POST(request: Request): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });

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
    appendClearedAuthCookies(headers);
    return new Response(null, { status: 204, headers });
  }

  let handle: string;
  try {
    handle = extractSsoSessionHandle(request);
  } catch {
    appendClearedAuthCookies(headers);
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({ redirectUrl: "/api/auth/akb/sso/logout" }),
      { status: 200, headers },
    );
  }

  try {
    await (await getSsoAuthRuntime()).sessions.logout(handle);
  } catch {
    // Redis deletion is authoritative. Preserve the browser handle so the
    // user can retry rather than reporting a logout that did not happen.
    return new Response(null, { status: 503, headers });
  }

  appendClearedAuthCookies(headers);
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ redirectUrl: "/api/auth/akb/sso/logout" }),
    { status: 200, headers },
  );
}

function appendClearedAuthCookies(headers: Headers): void {
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
}
