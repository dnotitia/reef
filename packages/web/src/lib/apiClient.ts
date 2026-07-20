import { isAkbAccountErrorCode } from "@reef/core";
import { recordAkbAccountDenial } from "./akb/accountDenialClient";
import { wipeAkbScopedBrowserState } from "./akb/accountReconcile";
import {
  AUTH_ACCOUNT_ERROR_HEADER,
  AUTH_INVALIDATED_HEADER,
  VAULT_HEADER,
} from "./akb/headers";
import { VAULT_NAME_RE } from "./akb/vaultName";
import { getActiveVault } from "./storage/config";

/**
 * A fetch() wrapper that attaches browser-local request context.
 *
 * LLM credentials are deployment-managed server-side via REEF_LLM_* env vars,
 * and GitHub grounding now uses deployment-managed GitHub App credentials, so
 * this client does not attach `X-Reef-LLM` or `Authorization`.
 *
 * This file has NO Next.js imports — it is a plain TypeScript module.
 */
export const apiClient = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Browser-local context is optional request decoration. IndexedDB can be
    // unavailable (private mode, denied storage, startup failure); that must not
    // turn login or an otherwise valid BFF request into a network error.
    const vault = await getActiveVault().catch(() => "");

    const headers = new Headers(init?.headers);

    // X-Reef-Vault — read by the chat Route Handler which does not accept a
    // `?vault=` querystring (the AI SDK transport owns the URL). Validated here
    // so a stale/typo'd Dexie entry doesn't reach the server. Identifier just —
    // not redacted by the logging middleware. The Dexie value is a
    // fallback: a caller that already knows the workspace from the URL `[vault]`
    // segment sets the header explicitly for tab-local request context, and the
    // shared Dexie pointer should not clobber it (REEF-315 — tab independence).
    if (!headers.has(VAULT_HEADER) && vault && VAULT_NAME_RE.test(vault)) {
      headers.set(VAULT_HEADER, vault);
    }

    // Pin credentials to same-origin so the `__reef_session` httpOnly cookie
    // (used by /api/auth/akb/me and any future authenticated reef-web endpoint)
    // is forwarded automatically without leaking cookies to cross-origin URLs
    // that might land in `input`.
    const response = await fetch(input, {
      credentials: "same-origin",
      ...init,
      headers,
    });
    if (response.headers.get(AUTH_INVALIDATED_HEADER) === "1") {
      const accountError = response.headers.get(AUTH_ACCOUNT_ERROR_HEADER);
      // The server has already invalidated the httpOnly session. In-memory
      // cleanup runs before accountReconcile touches IndexedDB; if persistent
      // storage is unavailable, preserve the authoritative denial response
      // instead of misreporting it as a network failure.
      try {
        await wipeAkbScopedBrowserState();
      } catch {
        // Best-effort persistent cleanup; the authoritative response wins.
      }
      if (isAkbAccountErrorCode(accountError)) {
        recordAkbAccountDenial(accountError);
      }
    }
    return response;
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
