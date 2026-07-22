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
import {
  consumePendingAkbAccountErrorIfUnchanged,
  recordAkbAccountDenialIfUnchanged,
  snapshotPendingAkbAccountError,
} from "./accountDenialClient";

export type AkbSessionStatus =
  | { active: true }
  | {
      active: false;
      accountError?: AkbAccountErrorCode;
      accountErrorToken?: string;
    };

function inactiveFromPendingDenial(): AkbSessionStatus {
  const pending = snapshotPendingAkbAccountError();
  return pending
    ? {
        active: false,
        accountError: pending.code,
        accountErrorToken: pending.token,
      }
    : { active: false };
}

export async function getAkbSessionStatus(
  signal?: AbortSignal,
): Promise<AkbSessionStatus> {
  const pendingAtProbeStart = snapshotPendingAkbAccountError();
  try {
    const res = await apiFetch("/api/auth/akb/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (res.ok) {
      consumePendingAkbAccountErrorIfUnchanged(pendingAtProbeStart);
      const remainingDenial = inactiveFromPendingDenial();
      return "accountError" in remainingDenial
        ? remainingDenial
        : { active: true };
    }

    const body: unknown = await res.json().catch(() => null);
    const code =
      body !== null && typeof body === "object" && "code" in body
        ? body.code
        : undefined;
    if (isAkbAccountErrorCode(code)) {
      const selected = recordAkbAccountDenialIfUnchanged(
        code,
        pendingAtProbeStart,
      );
      return {
        active: false,
        accountError: selected?.code ?? code,
        ...(selected ? { accountErrorToken: selected.token } : {}),
      };
    }
    return inactiveFromPendingDenial();
  } catch {
    return inactiveFromPendingDenial();
  }
}

export async function hasActiveAkbSession(
  signal?: AbortSignal,
): Promise<boolean> {
  return (await getAkbSessionStatus(signal)).active;
}
