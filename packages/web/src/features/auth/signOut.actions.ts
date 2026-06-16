"use client";

import { wipeAkbScopedBrowserState } from "@/lib/akb/accountReconcile";
import { isSafeSameOriginPath } from "@/lib/akb/safeRedirect";
import { apiFetch } from "@/lib/apiClient";

export interface SignOutResult {
  redirectUrl?: string;
}

/**
 * Sign out of the akb workspace (REEF-068).
 *
 * Independent of the GitHub PAT: this ends the akb session just, leaving the
 * GitHub connection (`credentials` store) intact (AC3). Two steps:
 *
 *  1. POST `/api/auth/akb/logout` expires the `__reef_session` cookie (AC2).
 *     akb has no server-side token revoke, so the cleared httpOnly cookie is
 *     the just session-termination lever.
 *  2. `wipeAkbScopedBrowserState` drops the akb-scoped client cache (persisted
 *     query snapshot + in-memory QueryClient, AC5) and the akb-scoped IndexedDB
 *     config — active vault, saved `filter:*`, `akb_user_id` (AC6). The wipe
 *     runs after the cookie is cleared, so a failed logout request leaves
 *     local state untouched and the caller can surface a retry.
 *
 * The GitHub PAT, monitored repos, and LLM config are person-scoped and
 * deliberately preserved by `wipeAkbScopedBrowserState`.
 */
export async function signOutOfWorkspace(): Promise<SignOutResult> {
  const res = await apiFetch("/api/auth/akb/logout", { method: "POST" });
  if (!res.ok) {
    throw new Error(`logout failed: ${res.status}`);
  }
  const redirectUrl = await readRedirectUrl(res);
  await wipeAkbScopedBrowserState();
  return redirectUrl ? { redirectUrl } : {};
}

async function readRedirectUrl(res: Response): Promise<string | null> {
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => null)) as {
    redirectUrl?: unknown;
  } | null;
  return typeof body?.redirectUrl === "string" &&
    isSafeSameOriginPath(body.redirectUrl)
    ? body.redirectUrl
    : null;
}
