/**
 * Client-side probe for an active akb workspace session.
 *
 * The `__reef_session` cookie is httpOnly, so the browser does not read it
 * directly. We instead call `/api/auth/akb/me`, which resolves the AKB-issued
 * JWT from the cookie. A 2xx means the session is valid. A stable AKB account
 * denial remains attached to the inactive result so the login surface can
 * explain a removal or suspension; unknown failures stay generic.
 *
 * Used by RootPage and OnboardingGuard to gate dashboard access without
 * trusting IndexedDB state alone.
 */
import { apiFetch } from "@/lib/apiClient";
import { isAkbAccountErrorCode } from "@reef/core";
import {
  consumePendingAkbAccountErrorIfUnchanged,
  recordAkbAccountDenialIfUnchanged,
  snapshotPendingAkbAccountError,
} from "./accountDenialClient";
import { hasEstablishedAuthSession } from "./authCoordinator";
import { AUTH_INVALIDATED_HEADER } from "./headers";
import type { AkbSessionStatus } from "./authSessionStatus";

export type { AkbSessionStatus } from "./authSessionStatus";

function inactiveFromPendingDenial():
  | Extract<AkbSessionStatus, { state: "inactive" }>
  | undefined {
  const pending = snapshotPendingAkbAccountError();
  return pending
    ? {
        state: "inactive",
        accountError: pending.code,
        accountErrorToken: pending.token,
      }
    : undefined;
}

function unavailableOrPendingDenial(): AkbSessionStatus {
  return inactiveFromPendingDenial() ?? { state: "unavailable" };
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
    const invalidated = res.headers.get(AUTH_INVALIDATED_HEADER) === "1";
    if (res.ok) {
      // A superseded route transition or coordinator timeout should not let a
      // late profile response consume or replace the newest denial marker.
      if (signal?.aborted) return unavailableOrPendingDenial();
      consumePendingAkbAccountErrorIfUnchanged(pendingAtProbeStart);
      const remainingDenial = inactiveFromPendingDenial();
      return remainingDenial ?? { state: "active" };
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
        state: "inactive",
        accountError: selected?.code ?? code,
        ...(selected ? { accountErrorToken: selected.token } : {}),
      };
    }
    const pendingDenial = inactiveFromPendingDenial();
    if (pendingDenial) return pendingDenial;
    if (invalidated) return { state: "inactive" };
    if (signal?.aborted) return { state: "unavailable" };
    // A plain first-visit 401 proves there is no session. Once this tab has
    // verified a session, a status-only 401 is ambiguous and must preserve it.
    if (res.status === 401 && !hasEstablishedAuthSession()) {
      return { state: "inactive" };
    }
    return { state: "unavailable" };
  } catch {
    return unavailableOrPendingDenial();
  }
}
