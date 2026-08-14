import {
  AUTH_ACCOUNT_ERROR_HEADER,
  AUTH_INVALIDATED_HEADER,
} from "@/lib/akb/headers";
import { buildClearedEstablishedAuthCookies } from "@/lib/akb/sessionCookie";
import { localizeError } from "@/lib/api/errorLocalization";
import { getAkbAdapter } from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  type AkbAccountErrorCode,
  AuthError,
  ReefError,
  akbGetMe,
  isAkbAccountErrorCode,
} from "@reef/core";

/**
 * GET /api/auth/akb/me
 *
 * Resolve the mode-aware `__reef_session` carrier and current AKB user through
 * `core` (`akbGetMe`), returning the public profile. A 401 means the selected
 * bearer credential is no longer valid, so Reef invalidates server state when
 * applicable and clears the browser carrier.
 *
 * REEF-052: the akb `/auth/me` wire call + schema live in `core`; this Route
 * Handler owns just cookie decode/clear and the PM-facing status matrix.
 * `akbGetMe` validates with a `z.looseObject` schema and does not throws on a
 * shape drift (observe), so a benign akb change does not knock a live
 * session into a 5xx — just an akb 401 (→ clear) or 5xx/network (→ 502) does.
 */
export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) {
    const response = await adapterResult.response;
    if (
      response.status === 401 &&
      response.headers.get(AUTH_INVALIDATED_HEADER) !== "1"
    ) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown } | null;
      return clearedSessionResponse(
        typeof body?.error === "string"
          ? body.error
          : "Your session has expired. Please sign in again.",
      );
    }
    return response;
  }

  let profile: unknown;
  try {
    ({ profile } = await akbGetMe({
      adapter: adapterResult.adapter,
    }));
  } catch (err) {
    if (err instanceof AuthError) {
      // AKB rejected the current bearer — clear the browser carrier.
      if (
        err.context.origin === "akb" &&
        isAkbAccountErrorCode(err.context.code)
      ) {
        const localized = (await localizeError(err)) as Response;
        const body = (await localized.json()) as { error: string };
        return clearedSessionResponse(body.error, err.context.code);
      }
      return clearedSessionResponse(
        "Your session has expired. Please sign in again.",
      );
    }
    if (err instanceof ReefError) {
      // Any other akb-translated error maps to the same 502 the pre-refactor
      // route returned for every non-401 non-ok response: 5xx/network surface as
      // AkbApiError, but a misconfigured 404/409/422 surfaces as
      // NotFound/Conflict/SchemaValidation through the adapter ladder.
      logger.error({ err }, "akb_me: unexpected backend status");
      return Response.json(
        { error: "The workspace backend rejected the request." },
        { status: 502 },
      );
    }
    throw err;
  }

  // Re-emit the full passthrough profile verbatim (key order may differ; no
  // in-repo consumer depends on byte identity).
  return Response.json(profile, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

function clearedSessionResponse(
  message: string,
  code?: AkbAccountErrorCode,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    [AUTH_INVALIDATED_HEADER]: "1",
  });
  if (code) headers.set(AUTH_ACCOUNT_ERROR_HEADER, code);
  for (const cookie of buildClearedEstablishedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(
    JSON.stringify({ error: message, ...(code ? { code } : {}) }),
    {
      status: 401,
      headers,
    },
  );
}
