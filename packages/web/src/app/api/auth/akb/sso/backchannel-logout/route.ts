import { OidcProtocolError } from "@/server/auth/oidcClient";
import { getSsoAuthRuntime } from "@/server/auth/runtime";
import { SsoSessionError } from "@/server/auth/ssoSessionService";

const MAX_BACKCHANNEL_BODY_BYTES = 512 * 1024;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

class BackchannelBodyTooLargeError extends Error {}

/** Receive Keycloak's OpenID Back-Channel Logout token without browser state. */
export async function POST(request: Request): Promise<Response> {
  let logoutToken: string | null;
  try {
    logoutToken = await readLogoutToken(request);
  } catch (error) {
    return new Response(null, {
      status: error instanceof BackchannelBodyTooLargeError ? 413 : 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (!logoutToken) {
    return new Response(null, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    await (await getSsoAuthRuntime()).sessions.backchannelLogout(logoutToken);
    return new Response(null, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    const status =
      error instanceof OidcProtocolError && error.kind !== "transient"
        ? 400
        : error instanceof SsoSessionError && error.kind !== "transient"
          ? 400
          : 503;
    return new Response(null, { status, headers: RESPONSE_HEADERS });
  }
}

async function readLogoutToken(request: Request): Promise<string | null> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return null;

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BACKCHANNEL_BODY_BYTES
  ) {
    throw new BackchannelBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let encoded = "";
  try {
    let readResult = await reader.read();
    while (!readResult.done) {
      const { value } = readResult;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BACKCHANNEL_BODY_BYTES) {
        throw new BackchannelBodyTooLargeError();
      }
      encoded += decoder.decode(value, { stream: true });
      readResult = await reader.read();
    }
    encoded += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const params = new URLSearchParams(encoded);
  const logoutTokens = params.getAll("logout_token");
  if (logoutTokens.length !== 1 || !logoutTokens[0]) return null;
  return logoutTokens[0];
}
