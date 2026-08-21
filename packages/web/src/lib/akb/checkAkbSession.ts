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
import type { AkbSessionStatus } from "./authSessionStatus";

export type { AkbSessionStatus } from "./authSessionStatus";

/** Upper bound for a direct session-status probe. */
export const AKB_SESSION_PROBE_TIMEOUT_MS = 5_000;

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
  timeoutMs = AKB_SESSION_PROBE_TIMEOUT_MS,
): Promise<AkbSessionStatus> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<AkbSessionStatus>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ active: false });
    }, timeoutMs);
  });

  const runProbe = async (): Promise<AkbSessionStatus> => {
    const pendingAtProbeStart = snapshotPendingAkbAccountError();
    try {
      const res = await apiFetch("/api/auth/akb/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      // A superseded route transition or timeout must not let a late profile
      // response consume or replace the denial marker for the newest probe.
      if (controller.signal.aborted) return inactiveFromPendingDenial();
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
  };

  try {
    return await Promise.race([runProbe(), timeoutResult]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function hasActiveAkbSession(
  signal?: AbortSignal,
): Promise<boolean> {
  return (await getAkbSessionStatus(signal)).active;
}
