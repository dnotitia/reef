/**
 * Build a JWT-shaped token (`header.payload.sig`) for Route Handler tests.
 *
 * `extractAkbSession` verifies the `exp` claim before forwarding the
 * cookie to the akb backend, so a base64url-encoded header + payload + any
 * non-empty signature segment is enough to pass the cookie guard in unit
 * tests. The akb backend signature is mocked at the adapter layer in every
 * Route Handler test that uses this helper.
 */
export function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

/**
 * Far-future `exp` (now + 1 hour) for tokens that should pass
 * `isJwtExpired`. Computed once at module load so individual tests don't
 * have to thread `Math.floor(Date.now() / 1000) + 60 * 60` through every
 * assertion.
 */
export const FUTURE_EXP = Math.floor(Date.now() / 1000) + 60 * 60;

/** Standard valid session JWT used by the happy-path route tests. */
export const VALID_JWT = makeJwt({ exp: FUTURE_EXP, sub: "u-1" });

/** Past-`exp` JWT for tests that need to exercise the expiry guard. */
export const EXPIRED_JWT = makeJwt({
  exp: Math.floor(Date.now() / 1000) - 60,
  sub: "u-1",
});
