/**
 * Client-side probe for an active akb workspace session.
 *
 * The `__reef_session` cookie is httpOnly, so the browser does not read it
 * directly. We instead call `/api/auth/akb/me`, which the server resolves
 * from the cookie. A 2xx means the session is valid. A stable AKB account
 * denial remains attached to the inactive result so the login surface can
 * explain a removal or suspension; unknown failures stay generic.
 *
 * Used by RootPage and OnboardingGuard to gate dashboard access without
 * trusting IndexedDB state alone.
 */
import { apiFetch } from "@/lib/apiClient";
import { type AkbAccountErrorCode, isAkbAccountErrorCode } from "@reef/core";
import { consumePendingAkbAccountError } from "./accountDenialClient";

export type AkbSessionStatus =
  | { active: true }
  | { active: false; accountError?: AkbAccountErrorCode };

export async function getAkbSessionStatus(
  signal?: AbortSignal,
): Promise<AkbSessionStatus> {
  try {
    const res = await apiFetch("/api/auth/akb/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (res.ok) {
      consumePendingAkbAccountError();
      return { active: true };
    }

    const body: unknown = await res.json().catch(() => null);
    const code =
      body !== null && typeof body === "object" && "code" in body
        ? body.code
        : undefined;
    if (isAkbAccountErrorCode(code)) {
      consumePendingAkbAccountError();
      return { active: false, accountError: code };
    }
    const pendingAccountError = consumePendingAkbAccountError();
    return pendingAccountError
      ? { active: false, accountError: pendingAccountError }
      : { active: false };
  } catch {
    return { active: false };
  }
}

export async function hasActiveAkbSession(
  signal?: AbortSignal,
): Promise<boolean> {
  return (await getAkbSessionStatus(signal)).active;
}
