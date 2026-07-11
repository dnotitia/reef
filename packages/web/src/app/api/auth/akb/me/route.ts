import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { extractAkbSession } from "@/lib/akb/extractAkbSession";
import { buildClearedEstablishedAuthCookies } from "@/lib/akb/sessionCookie";
import { localizeError } from "@/lib/api/errorLocalization";
import { logger } from "@/lib/logging/logger";
import {
  AuthError,
  ReefError,
  akbGetMe,
  createAkbAdapter,
  isAkbAccountErrorCode,
} from "@reef/core";

/**
 * GET /api/auth/akb/me
 *
 * Decode the `__reef_session` cookie and resolve the current akb user through
 * `core` (`akbGetMe`), returning the public profile. A 401 from akb means the
 * JWT is no longer valid (expired or revoked) — we clear the cookie defensively
 * so the client falls back to /login on the next render.
 *
 * REEF-052: the akb `/auth/me` wire call + schema live in `core`; this Route
 * Handler owns just cookie decode/clear and the PM-facing status matrix.
 * `akbGetMe` validates with a `.passthrough()` schema and does not throws on a
 * shape drift (observe), so a benign akb change does not knock a live
 * session into a 5xx — just an akb 401 (→ clear) or 5xx/network (→ 502) does.
 */
export async function GET(request: Request): Promise<Response> {
  let jwt: string;
  try {
    jwt = extractAkbSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return clearedSessionResponse(err.toUserMessage());
    }
    throw err;
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_me: backend url missing");
    return Response.json(
      { error: "The workspace backend is not configured." },
      { status: 503 },
    );
  }

  let profile: unknown;
  try {
    ({ profile } = await akbGetMe({
      adapter: createAkbAdapter({ baseUrl: backendUrl, jwt }),
    }));
  } catch (err) {
    if (err instanceof AuthError) {
      // akb rejected the JWT (expired/revoked) — clear the cookie defensively.
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

function clearedSessionResponse(message: string, code?: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
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
