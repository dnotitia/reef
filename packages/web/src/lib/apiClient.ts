import { VAULT_HEADER } from "./akb/headers";
import { VAULT_NAME_RE } from "./akb/vaultName";
import { getActiveVault } from "./storage/config";

/**
 * A fetch() wrapper that attaches browser-local request context.
 *
 * LLM credentials are deployment-managed server-side via OpenRouter env vars,
 * and GitHub grounding now uses deployment-managed GitHub App credentials, so
 * this client does not attach `X-Reef-LLM` or `Authorization`.
 *
 * This file has NO Next.js imports — it is a plain TypeScript module.
 */
export const apiClient = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const vault = await getActiveVault();

    const headers = new Headers(init?.headers);

    // X-Reef-Vault — read by the chat Route Handler which does not accept a
    // `?vault=` querystring (the AI SDK transport owns the URL). Validated
    // here so a stale/typo'd Dexie entry doesn't reach the server. Identifier
    // just — not redacted by the logging middleware.
    if (vault && VAULT_NAME_RE.test(vault)) {
      headers.set(VAULT_HEADER, vault);
    }

    // Pin credentials to same-origin so the `__reef_session` httpOnly cookie
    // (used by /api/auth/akb/me and any future authenticated reef-web endpoint)
    // is forwarded automatically without leaking cookies to cross-origin URLs
    // that might land in `input`.
    return fetch(input, { credentials: "same-origin", ...init, headers });
  },
};

/**
 * Bound reference to `apiClient.fetch` for ergonomic consumption:
 *   import { apiFetch } from "@/lib/apiClient";
 *   const res = await apiFetch("/api/issues");
 *
 * Bound to `apiClient` so callers can freely destructure or reassign without
 * losing the `this` context. This is a reference alias — not a wrapper — so
 * it does not drift out of sync with the underlying implementation.
 */
export const apiFetch: (typeof apiClient)["fetch"] =
  apiClient.fetch.bind(apiClient);

/**
 * Error thrown by `throwHttpError` after a non-OK `apiFetch` response. Carries
 * the HTTP status so callers can branch on `err.status === 409` (CAS conflict),
 * `=== 401` (auth), etc., and the optional server-provided `details` payload.
 */
export interface HttpError extends Error {
  status: number;
  details?: unknown;
}

/**
 * Reads the JSON body of a non-OK response and throws an `HttpError` with the
 * server-provided `error` message (falling back to `fallbackMsg`), the status
 * code, and any `details` shape. Tolerates non-JSON bodies — falls back to
 * `fallbackMsg` if `res.json()` rejects or is empty.
 *
 * Use after a `!res.ok` check so all hook-layer fetch failures surface with
 * the same shape, instead of each call site reinventing the parse.
 */
export async function throwHttpError(
  res: Response,
  fallbackMsg: string,
): Promise<never> {
  const detail = (await res.json().catch(() => ({}))) as {
    error?: string;
    details?: unknown;
  };
  const msg = detail.error ?? fallbackMsg;
  throw Object.assign(new Error(msg), {
    status: res.status,
    details: detail.details,
  }) as HttpError;
}
