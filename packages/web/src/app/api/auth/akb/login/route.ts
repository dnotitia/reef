import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  buildClearedSsoCookies,
  buildSessionCookie,
  decodeJwtExp,
} from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { AkbApiError, AuthError, akbLogin } from "@reef/core";
import { z } from "zod";

/**
 * POST /api/auth/akb/login
 *
 * Proxy username/password to the akb backend, then store the returned JWT as
 * an httpOnly `__reef_session` cookie. The JWT itself does not reach the
 * browser body — the public `user` profile does.
 *
 * REEF-052: the akb wire call + response schema live in `core` (`akbLogin`);
 * this Route Handler owns just request validation, the PM-facing status matrix,
 * and the session-cookie lifecycle. login is standalone in core because it runs
 * before a JWT exists and does not ride the JWT-in-closure adapter.
 *
 * reef-web does not keep the JWT in memory beyond this request. The cookie is
 * the sole persistence; akb is the signing authority.
 */

const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = LoginRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch (err) {
    logger.error({ err }, "akb_login: backend url missing");
    return Response.json(
      { error: "The workspace backend is not configured." },
      { status: 503 },
    );
  }

  let result: { token: string; user: unknown };
  try {
    result = await akbLogin({
      baseUrl: backendUrl,
      username: parsed.data.username,
      password: parsed.data.password,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json(
        { error: "Invalid username or password." },
        { status: 401 },
      );
    }
    if (err instanceof AkbApiError) {
      if (err.status === 422) {
        return Response.json(
          { error: "Username and password are required." },
          { status: 422 },
        );
      }
      logger.error(
        { err, status: err.status },
        "akb_login: unexpected backend response",
      );
      return Response.json(
        { error: "The workspace backend rejected the request." },
        { status: 502 },
      );
    }
    throw err;
  }

  const jwt = result.token;
  const exp = decodeJwtExp(jwt);
  const nowSec = Math.floor(Date.now() / 1000);
  const maxAgeSeconds =
    exp && exp > nowSec
      ? Math.min(exp - nowSec, DEFAULT_SESSION_MAX_AGE_SECONDS)
      : DEFAULT_SESSION_MAX_AGE_SECONDS;

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", buildSessionCookie(jwt, { maxAgeSeconds }));
  for (const cookie of buildClearedSsoCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Cache-Control", "no-store");

  return new Response(JSON.stringify({ user: result.user }), {
    status: 200,
    headers,
  });
}
