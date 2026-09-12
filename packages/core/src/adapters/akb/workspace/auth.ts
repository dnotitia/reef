import { z } from "zod";
import { AkbApiError, AuthError, isAkbAccountErrorCode } from "../../../errors";
import { stripTrailingSlashes } from "../../url";
import { readAkbErrorResponse } from "../core/errorResponse";
import type { AkbAdapter } from "../core/http";
import { readAkbJsonBody } from "../core/responseBody";
import { withSpan } from "../core/shared";

const AKB_AUTH_TIMEOUT_MS = 5_000;
const MAX_AKB_AUTH_RESPONSE_BYTES = 2 * 1024 * 1024;

// ─── Canonical akb auth response schemas (single core home) ───────────────────
//
// REEF-052: these previously lived inline in `web` (login/route.ts and
// requestHelpers.ts). core is the single origin of every akb wire schema, so
// the auth envelopes belong here alongside the auth client.

export const AkbUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  email: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().optional(),
});

export type AkbUser = z.infer<typeof AkbUserSchema>;

const AkbLoginResponseSchema = z.object({
  token: z.string().min(1),
  user: AkbUserSchema,
});

export const AkbAuthProviderTypeSchema = z.enum([
  "oidc",
  "keycloak-oidc",
  "local-realm",
]);

export type AkbAuthProviderType = z.infer<typeof AkbAuthProviderTypeSchema>;

const AkbAuthProviderSchema = z
  .object({
    provider_type: AkbAuthProviderTypeSchema,
    alias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/u),
    display_name: z.string().min(1).max(120),
    login_url: z.string().min(1).nullable(),
  })
  .strict();

const authConfigCommon = {
  schema_version: z.literal(2),
  mcp_oauth: z.object({ enabled: z.boolean() }).strict(),
};

function providerCatalogSchema() {
  return z
    .array(AkbAuthProviderSchema)
    .max(32)
    .superRefine((providers, context) => {
      const aliases = new Set<string>();
      for (const [index, provider] of providers.entries()) {
        if (aliases.has(provider.alias)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "alias"],
            message: "provider aliases must be unique",
          });
        }
        aliases.add(provider.alias);
      }
    });
}

const AkbLocalAuthConfigSchema = z
  .object({
    ...authConfigCommon,
    auth_mode: z.literal("local"),
    local_auth: z.object({ enabled: z.literal(true) }).strict(),
    keycloak: z
      .object({
        enabled: z.literal(false),
        browser_session_ready: z.literal(false),
      })
      .strict(),
    providers: z.array(AkbAuthProviderSchema).length(0),
  })
  .strict();

const AkbSsoAuthConfigSchema = z
  .object({
    ...authConfigCommon,
    auth_mode: z.literal("sso"),
    local_auth: z.object({ enabled: z.literal(false) }).strict(),
    keycloak: z
      .object({ enabled: z.literal(true), browser_session_ready: z.boolean() })
      .strict(),
    providers: providerCatalogSchema(),
  })
  .strict();

export const AkbAuthConfigSchema = z.discriminatedUnion("auth_mode", [
  AkbLocalAuthConfigSchema,
  AkbSsoAuthConfigSchema,
]);

export type AkbAuthConfig = z.infer<typeof AkbAuthConfigSchema>;

export const AKB_AUTH_V2_ACCOUNT_DENIAL_CODES = [
  "membership_required",
  "account_suspended",
  "identity_conflict",
] as const;

export type AkbAuthV2AccountDenialCode =
  (typeof AKB_AUTH_V2_ACCOUNT_DENIAL_CODES)[number];

export type AkbAuthV2Config = AkbAuthConfig;

// `/auth/me` wire shape. `z.looseObject` is LOAD-BEARING: email / display_name
// / is_admin / auth_method (and any future akb field) should survive untouched so
// the me route can re-emit the public profile verbatim. Every identifier field
// stays `.optional()` so the actor-resolution fallback union is preserved.
export const AkbCurrentUserSchema = z.looseObject({
  username: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  sub: z.string().min(1).optional(),
});

export type AkbCurrentUser = z.infer<typeof AkbCurrentUserSchema>;

// Client-facing projection of `/auth/me` for DISPLAY surfaces (the workspace
// account menu). Unlike `AkbCurrentUserSchema` — which is `z.looseObject` and
// observe so the me route can re-emit the profile verbatim — this STRIPS
// to the handful of fields the UI renders, so a `web` consumer imports a typed
// shape instead of reaching into passthrough keys. Every field is optional:
// akb may omit `display_name`/`email`, and the UI falls back to the username or
// a neutral "Account" label. Strip (Zod's default) discards unknown akb fields.
export const AkbMeProfileSchema = z.object({
  username: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  display_name: z.string().min(1).nullable().optional(),
  email: z.string().min(1).nullable().optional(),
});

export type AkbMeProfile = z.infer<typeof AkbMeProfileSchema>;

// ─── login: STANDALONE (no JWT yet) ───────────────────────────────────────────
//
// `login` runs BEFORE a JWT exists — it exchanges credentials FOR the token — so
// it does not ride the JWT-in-closure adapter (`createAkbAdapter`). It performs a
// single token-less `fetch` and maps the akb HTTP status onto the same error
// ladder `http.ts` uses (401/403 → AuthError; everything else → AkbApiError with
// the status preserved). A schema/JSON failure is surfaced as `AkbApiError(502)`
// rather than a raw `ZodError` so the boundary  emits `ReefError`s.

export interface AkbLoginParams {
  baseUrl: string;
  username: string;
  password: string;
}

export interface AkbLoginResult {
  /** Raw akb-issued JWT — web stores it as the httpOnly cookie, does not echoes it. */
  token: string;
  /** Public user profile safe to return in the login response body. */
  user: AkbUser;
}

export function login(params: AkbLoginParams): Promise<AkbLoginResult> {
  const { baseUrl, username, password } = params;
  return withSpan("akb.auth.login", {}, async (span) => {
    const url = `${stripTrailingSlashes(baseUrl)}/api/v1/auth/login`;
    const signal = AbortSignal.timeout(AKB_AUTH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
        redirect: "manual",
        signal,
      });
    } catch (err) {
      throw new AkbApiError({
        status: 0,
        message: err instanceof Error ? err.message : "Network error",
      });
    }
    if (!response.ok) {
      const error = await readAkbErrorResponse(response, {
        maxBytes: MAX_AKB_AUTH_RESPONSE_BYTES,
        signal,
      });
      if (
        response.status === 401 ||
        response.status === 403 ||
        isAkbAccountErrorCode(error.code)
      ) {
        throw new AuthError({
          origin: "akb",
          code: error.code,
          status: response.status,
          message: error.message,
        });
      }
      // Preserve the status so the route can keep its 422/502 matrix.
      throw new AkbApiError({
        status: response.status,
        message: "login_failed",
      });
    }
    let payload: unknown;
    try {
      payload = await readAkbJsonBody(response, {
        maxBytes: MAX_AKB_AUTH_RESPONSE_BYTES,
        signal,
      });
    } catch {
      throw new AkbApiError({ status: 502, message: "login_non_json" });
    }
    // Boundary convention: does not leak a raw ZodError across the core boundary.
    // Catch the parse failure and throw a ReefError so the route's 502 path is
    // reached deterministically rather than via a 500 fallthrough.
    const parsed = AkbLoginResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AkbApiError({ status: 502, message: "login_shape_mismatch" });
    }
    span.setAttribute("user_id", parsed.data.user.id);
    return { token: parsed.data.token, user: parsed.data.user };
  });
}

// ─── SSO helpers: STANDALONE (token-less akb auth surface) ───────────────────

export interface GetAuthConfigParams {
  baseUrl: string;
}

export interface GetAuthConfigResult {
  config: AkbAuthConfig;
}

export function getAuthConfig(
  params: GetAuthConfigParams,
): Promise<GetAuthConfigResult> {
  const { baseUrl } = params;
  return withSpan("akb.auth.config", {}, async (span) => {
    const payload = await fetchTokenlessJson({
      baseUrl,
      path: "/api/v1/auth/config",
      method: "GET",
      failureMessage: "auth_config_failed",
      nonJsonMessage: "auth_config_non_json",
    });
    const parsed = AkbAuthConfigSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AkbApiError({
        status: 502,
        message: "auth_config_shape_mismatch",
      });
    }
    span.setAttribute("auth_mode", parsed.data.auth_mode);
    span.setAttribute("keycloak_enabled", parsed.data.keycloak.enabled);
    span.setAttribute("provider_count", parsed.data.providers.length);
    return { config: parsed.data };
  });
}

async function fetchTokenlessJson(params: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  failureMessage: string;
  nonJsonMessage: string;
  authStatuses?: Set<number>;
}): Promise<unknown> {
  const {
    baseUrl,
    path,
    method,
    body,
    failureMessage,
    nonJsonMessage,
    authStatuses,
  } = params;
  const url = `${stripTrailingSlashes(baseUrl)}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  let serializedBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }
  let response: Response;
  const signal = AbortSignal.timeout(AKB_AUTH_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      method,
      headers,
      body: serializedBody,
      redirect: "manual",
      signal,
    });
  } catch (err) {
    throw new AkbApiError({
      status: 0,
      message: err instanceof Error ? err.message : "Network error",
    });
  }
  if (!response.ok) {
    const error = await readAkbErrorResponse(response, {
      maxBytes: MAX_AKB_AUTH_RESPONSE_BYTES,
      signal,
    });
    if (
      authStatuses?.has(response.status) ||
      isAkbAccountErrorCode(error.code)
    ) {
      throw new AuthError({
        origin: "akb",
        code: error.code,
        status: response.status,
        message: error.message,
      });
    }
    throw new AkbApiError({
      status: response.status,
      message: failureMessage,
    });
  }
  try {
    return await readAkbJsonBody(response, {
      maxBytes: MAX_AKB_AUTH_RESPONSE_BYTES,
      signal,
    });
  } catch {
    throw new AkbApiError({ status: 502, message: nonJsonMessage });
  }
}

// ─── getMe: rides the per-request JWT-in-closure adapter ──────────────────────

export interface GetMeParams {
  adapter: AkbAdapter;
}

export interface GetMeResult {
  /** Full validated + passthrough profile (verbatim-equivalent for the me route). */
  profile: AkbCurrentUser;
}

export function getMe(params: GetMeParams): Promise<GetMeResult> {
  const { adapter } = params;
  return withSpan("akb.auth.me", {}, async (span) => {
    // adapter.request inherits the http.ts ladder: akb 401/403 → AuthError, etc.
    const payload = await adapter.request("/api/v1/auth/me", {
      resource: "session",
    });
    // passthrough preserves akb fields; a parse failure is OBSERVE —
    // we record it on the span and return the raw payload, does not throwing, so a
    // benign akb shape drift can not knock a live session into a 5xx.
    const result = AkbCurrentUserSchema.safeParse(payload);
    if (!result.success) {
      span.setAttribute("schema_mismatch", true);
      return { profile: (payload ?? {}) as AkbCurrentUser };
    }
    return { profile: result.data };
  });
}

// ─── getCurrentActor: actor-resolution for issue author/audit fields ──────────

export interface GetCurrentActorParams {
  adapter: AkbAdapter;
  /** Caller-decoded JWT, used for the claim fallback. core does not parses the cookie. */
  jwt: string;
}

export interface GetCurrentActorResult {
  actor: string | null;
}

export function getCurrentActor(
  params: GetCurrentActorParams,
): Promise<GetCurrentActorResult> {
  const { adapter, jwt } = params;
  return withSpan("akb.auth.current_actor", {}, async () => {
    const { profile } = await getMe({ adapter });
    // `getMe` is observe on a schema mismatch, so a malformed `/auth/me`
    // can hand back an empty string or a non-string identifier. Validate each
    // candidate at runtime (mirrors the schema's `.min(1)` string guard) and
    // skip to the next field — or the JWT claim — when one is invalid, rather
    // than trust a `??` chain that would accept "" or a number as the actor.
    const actor =
      firstNonEmptyString(profile.username, profile.user_id, profile.id) ??
      decodeJwtActor(jwt);
    return { actor };
  });
}

/** First candidate that is a non-empty string at runtime, else null. */
function firstNonEmptyString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Pure JWT-claim decode — framework-agnostic base64url (no Node `Buffer`).
 *
 * Used just as the actor fallback when akb `/auth/me` omits a public
 * identifier. The signature is NOT verified — akb re-validates every forwarded
 * request — so this reads claims for display/audit purposes just.
 */
function decodeJwtActor(jwt: string): string | null {
  const segments = jwt.split(".");
  if (segments.length < 2) return null;
  try {
    const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded); // global Web API, not Node Buffer
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const claims = JSON.parse(json) as Record<string, unknown>;
    for (const key of ["username", "preferred_username", "sub"]) {
      const value = claims[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}
