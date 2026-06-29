/**
 * Cross-route helpers used by Next.js Route Handlers. Centralizes parsing,
 * adapter construction, and PM-vocabulary error responses so all akb-backed
 * endpoints share one wording and one error-translation ladder.
 */

import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { extractAkbSession } from "@/lib/akb/extractAkbSession";
import { decodeSessionUsername } from "@/lib/akb/sessionCookie";
import {
  type AkbAdapter,
  type AkbResourceLabel,
  AuthError,
  NotFoundError,
  SchemaValidationError,
  VAULT_NAME_PATTERN,
  VaultNameSchema,
  akbGetCurrentActor,
  akbListVaults,
  createAkbAdapter,
} from "@reef/core";
import type { z } from "zod";
import { localizeError, localizedErrorResponse } from "./errorLocalization";

export const VAULT_NAME_RE = VAULT_NAME_PATTERN;

/** Strict `owner/name` regex — rejects empty parts, embedded slashes, or whitespace. */
const REPO_QUERY_RE = /^[^/]+\/[^/]+$/;

export { VaultNameSchema };

/**
 * `{PREFIX}-{NUMBER}` in either case. The route handlers concatenate the
 * matched value into URL paths so any deviation (slashes, dots, null bytes)
 * should be rejected before it reaches the adapter.
 */
const ISSUE_ID_PATH_REGEX = /^[A-Za-z]+-\d+$/;

export function isValidIssueIdPathParam(id: string): boolean {
  return ISSUE_ID_PATH_REGEX.test(id);
}

export interface RepoParts {
  owner: string;
  repo: string;
}

/**
 * Parses the `repo` query parameter from a Request URL.
 * Returns `null` when missing or malformed — callers translate `null` into a
 * 400 response with their preferred wording.
 *
 * Kept for monitored-repo routes (activity/detect, repos, etc.) that still
 * talk to GitHub directly.
 */
function parseRepoParam(request: Request): RepoParts | null {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("repo");
  if (!raw || !REPO_QUERY_RE.test(raw)) return null;
  const [owner, repo] = raw.split("/") as [string, string];
  return { owner, repo };
}

/**
 * Parses the `vault` query parameter from a Request URL.
 * Returns `null` when missing or malformed (caller translates to 400).
 */
export function parseVaultParam(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("vault");
  if (!raw || !VAULT_NAME_RE.test(raw)) return null;
  return raw;
}

/** Issue-list facets that may repeat in the query string (→ SQL `IN`).
 *  assigned_to / requester / sprint_id / release_id joined the multi-select set
 *  in REEF-267; milestone_id stays single (multi-select out of scope). */
const ISSUE_LIST_MULTI_KEYS = [
  "status",
  "priority",
  "severity",
  "issue_type",
  "assigned_to",
  "requester",
  "sprint_id",
  "release_id",
] as const;

/** Single-valued issue-list facets / sort / pagination params. */
const ISSUE_LIST_SINGLE_KEYS = [
  "milestone_id",
  "due_before",
  "due_after",
  "q",
  "sort_field",
  "sort_order",
  "cursor",
] as const;

/**
 * Extract issue-list query facets from a request URL into the shape
 * `IssueListQuerySchema` expects (arrays for multi-value facets, coerced
 * `archived` / `limit`). Returns `null` when no issue-list params are present,
 * so the handler falls back to the unfiltered full-vault listing. A
 * non-numeric `limit` is passed through verbatim so Zod rejects it (→ 400)
 * rather than being silently dropped.
 */
export function parseIssueListQueryParams(
  searchParams: URLSearchParams,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of ISSUE_LIST_MULTI_KEYS) {
    const values = searchParams.getAll(key);
    if (values.length > 0) out[key] = values;
  }
  for (const key of ISSUE_LIST_SINGLE_KEYS) {
    const value = searchParams.get(key);
    if (value != null) out[key] = value;
  }
  const archived = searchParams.get("archived");
  if (archived != null) out.archived = archived === "true";
  const defaultView = searchParams.get("default_view");
  if (defaultView != null) out.default_view = defaultView === "true";
  const limit = searchParams.get("limit");
  if (limit != null) {
    const parsed = Number(limit);
    out.limit = Number.isFinite(parsed) ? parsed : limit;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ─── 4xx helpers ─────────────────────────────────────────────────────────────
//
// These web-owned boundary errors resolve their copy from the `errors.*` catalog
// at the request locale (REEF-297). They return a Promise because locale
// detection reads `next/headers`; a Route Handler returning `helper()` from its
// async body flattens the Promise, so call sites are unchanged.

function authErrorResponse(): Promise<Response> {
  return localizedErrorResponse("sessionExpired", 401);
}

export function invalidJsonBodyResponse(): Promise<Response> {
  return localizedErrorResponse("invalidJsonBody", 400);
}

export function invalidBodyResponse(zodError: z.ZodError): Promise<Response> {
  return localizedErrorResponse("invalidBody", 400, {
    details: zodError.flatten(),
  });
}

export function missingVaultParamResponse(): Promise<Response> {
  return localizedErrorResponse("missingVault", 400);
}

export function invalidIssueIdResponse(): Promise<Response> {
  return localizedErrorResponse("invalidIssueId", 400);
}

// ─── akb error translation ───────────────────────────────────────────────────

/** 502 for an unreachable/misconfigured workspace backend (non-ReefError path). */
function backendErrorResponse(): Promise<Response> {
  return localizedErrorResponse("backend", 502);
}

/**
 * Forcibly tag a NotFound/Schema error with a curated `resourceKind` so the
 * resolved message is resource-specific (e.g. "Issue not found."). Overwrites any
 * free-form `resource` the adapter set — the akb adapters throw
 * `NotFoundError({ resource: "issue REEF-001" })`, so re-tagging is mandatory to
 * keep curated copy. Non-NotFound/Schema errors pass through unchanged.
 */
function withResource(err: unknown, resourceKind: AkbResourceLabel): unknown {
  if (err instanceof NotFoundError) {
    return new NotFoundError({ ...err.context, resourceKind });
  }
  if (err instanceof SchemaValidationError) {
    return new SchemaValidationError({ ...err.context, resourceKind });
  }
  return err;
}

/**
 * Single entry point for Route Handler error translation. `core` describes the
 * error as a locale-free `{ code, status }` (`describeError`); this delegates to
 * the web `localizeError` boundary, which resolves the active locale and returns
 * the PM-facing copy in that language (REEF-297), optionally overlaying
 * resource-specific copy via `withResource`. Returns a Promise (locale detection
 * reads `next/headers`); a Route Handler `return respondWithError(...)` flattens
 * it, so call sites are unchanged.
 *
 * should not log — callers own observability and should call `logger.error(...)`
 * from the redacting logger immediately before calling this.
 */
export function respondWithError(
  err: unknown,
  ctx?: { resourceKind?: AkbResourceLabel },
): Promise<Response> {
  return localizeError(
    ctx?.resourceKind ? withResource(err, ctx.resourceKind) : err,
  );
}

// ─── Adapter construction ────────────────────────────────────────────────────

/**
 * Build a per-request akb adapter from the session cookie. Returns the
 * adapter on success, or a 401 Response when the cookie is missing/expired.
 *
 * The adapter is scoped to one request — does not cached at module scope.
 */
export function getAkbAdapter(
  request: Request,
): { adapter: AkbAdapter } | { response: Promise<Response> } {
  let jwt: string;
  try {
    jwt = extractAkbSession(request);
  } catch {
    // The localized response is a Promise (locale detection is async). This
    // helper stays sync; every consumer either `return`s `.response` (the async
    // Route Handler flattens it) or ignores it, so the deferral is invisible.
    return { response: authErrorResponse() };
  }
  return { adapter: createAkbAdapter({ baseUrl: getAkbBackendUrl(), jwt }) };
}

/**
 * Resolve the currently authenticated akb user for reef semantic actor fields.
 *
 * The actor is not persisted server-side. We validate the httpOnly session on
 * each mutating request via akb `/auth/me` (through core `akbGetCurrentActor`),
 * then use the public username for `Issue.created_by` / `Issue.updated_by`. A
 * JWT claim is just a fallback for older akb deployments that do not return the
 * expected public profile shape.
 *
 * REEF-052: the akb wire call, schema, and claim-decode now live in `core`.
 * This helper keeps cookie decode (web-owned) and the PM-facing error mapping.
 * The web signature is unchanged — core returns `{ actor: string | null }`, and
 * a `null` actor is collapsed here into a 502 so callers can keep consuming
 * `actor` as a non-null string.
 */
export async function getAkbCurrentActor(
  request: Request,
): Promise<{ actor: string } | { response: Response }> {
  // This helper is already async, so it awaits the localized error responses to
  // a settled `Response` — the GitHub credential resolvers read `.status` off
  // this `response` arm, so it needs to be settled.
  let jwt: string;
  try {
    jwt = extractAkbSession(request);
  } catch {
    return { response: await authErrorResponse() };
  }

  let backendUrl: string;
  try {
    backendUrl = getAkbBackendUrl();
  } catch {
    return { response: await backendErrorResponse() };
  }

  let actor: string | null;
  try {
    ({ actor } = await akbGetCurrentActor({
      adapter: createAkbAdapter({ baseUrl: backendUrl, jwt }),
      jwt,
    }));
  } catch (err) {
    if (err instanceof AuthError) {
      return { response: await authErrorResponse() };
    }
    return { response: await backendErrorResponse() };
  }

  if (!actor) return { response: await backendErrorResponse() };
  return { actor };
}

/**
 * Best-effort current actor for read paths (e.g. the issue-list default view).
 * Returns the akb username, or `null` when the session is expired/unreachable —
 * callers degrade gracefully rather than failing the request. does not persists or
 * logs the identity.
 *
 * Fast path (REEF-324): decode the actor from the session cookie's akb
 * `username` claim so the default-view landing pays NO akb `/auth/me` round-trip
 * in the common case. The `username` claim is used — it is the akb-native
 * username, the same value `/auth/me` returns and that `assigned_to` stores, so
 * the fast-path actor equals the canonical actor `getAkbCurrentActor` would
 * resolve. (`preferred_username` / `sub` are deliberately NOT used here: an SSO
 * display name or an opaque UUID need not match `assigned_to`, which would
 * mis-scope the My-Issues view.) This is sound because the read-path actor
 * *scopes* the landing list — it is not an authorization decision; the data
 * query still forwards the real bearer token to akb, which re-validates it. The
 * signature is not verified.
 *
 * Fallback: a token that carries no `username` claim resolves via `/auth/me`
 * (one round-trip), the same canonical path the write actor uses — so the
 * behavior is unchanged for those tokens, just no longer paid on every landing.
 */
export async function resolveOptionalActor(
  request: Request,
): Promise<string | null> {
  let jwt: string;
  try {
    jwt = extractAkbSession(request);
  } catch {
    // Missing or expired cookie — degrade to no actor (caller floors the view).
    return null;
  }
  const usernameClaim = decodeSessionUsername(jwt);
  if (usernameClaim) return usernameClaim;
  const result = await getAkbCurrentActor(request);
  return "response" in result ? null : result.actor;
}

/**
 * Enforce the owner-scoped policy for destructive workspace-lifecycle actions
 * (REEF-322 delete / detach). akb's own floor for deleting a vault or dropping a
 * table is *admin*, but reef restricts these to the workspace owner — so the
 * server verifies the caller's role rather than trusting the client-side
 * Danger Zone gate (a non-owner admin could otherwise call the route directly).
 * The caller's per-vault role comes from the same `my/vaults` projection the UI
 * gate reads. Returns `{ owner: true }` to proceed, or `{ response }` (403, or a
 * translated upstream error) to return as-is.
 */
export async function requireVaultOwner(
  adapter: AkbAdapter,
  vault: string,
): Promise<{ owner: true } | { response: Response }> {
  let role: string | null;
  try {
    const { vaults } = await akbListVaults({ adapter });
    role = vaults.find((v) => v.name === vault)?.role ?? null;
  } catch (err) {
    return {
      response: await respondWithError(err, { resourceKind: "workspace" }),
    };
  }
  if (role === "owner") return { owner: true };
  return {
    response: await localizedErrorResponse("workspaceOwnerRequired", 403),
  };
}
