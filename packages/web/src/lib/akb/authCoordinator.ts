import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import type { AkbAccountErrorCode } from "@reef/core";
import type { AkbSessionStatus } from "./authSessionStatus";

/** The maximum time one browser auth probe may remain pending. */
export const AUTH_PROBE_TIMEOUT_MS = 5_000;
export const AUTH_PROBE_RETRY_DELAY_MS = 250;
const AUTH_PROBE_MAX_ATTEMPTS = 2;

export type AuthCoordinatorStatus =
  | "checking"
  | "active"
  | "inactive"
  | "unavailable";

export interface AuthCoordinatorSnapshot {
  status: AuthCoordinatorStatus;
  generation: number;
  accountError?: AkbAccountErrorCode;
  accountErrorToken?: string;
}

export type AuthProbe = (signal: AbortSignal) => Promise<AkbSessionStatus>;

const INITIAL_SNAPSHOT: AuthCoordinatorSnapshot = {
  status: "checking",
  generation: 0,
};

let snapshot = INITIAL_SNAPSHOT;
let generation = 0;
let currentProbe:
  | {
      controller: AbortController;
      generation: number;
    }
  | undefined;
let latestProbe: AuthProbe | undefined;
let establishedSession = false;
const listeners = new Set<(value: AuthCoordinatorSnapshot) => void>();
let lifecycleInstalled = false;

function notify(): void {
  for (const listener of listeners) listener(snapshot);
}

function setStatus(
  status: AuthCoordinatorStatus,
  result?: Extract<AkbSessionStatus, { state: "inactive" }>,
): void {
  if (status === "active") establishedSession = true;
  if (status === "inactive") establishedSession = false;
  snapshot = {
    status,
    generation,
    ...(result?.accountError ? { accountError: result.accountError } : {}),
    ...(result?.accountErrorToken
      ? { accountErrorToken: result.accountErrorToken }
      : {}),
  };
  notify();
}

function cancelCurrentProbe(): void {
  generation += 1;
  currentProbe?.controller.abort();
  currentProbe = undefined;
}

function onAuthChanged(): void {
  invalidateAuthSession();
}

function onFocus(): void {
  if (snapshot.status !== "active" || !latestProbe) return;
  revalidateAuthSession(latestProbe);
}

function onVisibilityChange(): void {
  if (document.visibilityState !== "visible") return;
  onFocus();
}

function installLifecycleListeners(): void {
  if (
    lifecycleInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  lifecycleInstalled = true;
  window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function removeLifecycleListeners(): void {
  if (!lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = false;
  window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

/** Current coordinator state, used by response classification in apiClient. */
export function getAuthCoordinatorSnapshot(): AuthCoordinatorSnapshot {
  return snapshot;
}

/** Whether this tab has previously verified an established session. */
export function hasEstablishedAuthSession(): boolean {
  return establishedSession;
}

/**
 * Subscribe a protected guard to the shared coordinator. The current snapshot
 * is intentionally not pushed during subscription: the caller decides whether
 * a cold bootstrap is needed, which prevents a stale inactive state from
 * redirecting a successful post-login navigation before its new session is
 * verified.
 */
export function subscribeAuthCoordinator(
  listener: (value: AuthCoordinatorSnapshot) => void,
  probe: AuthProbe,
): () => void {
  listeners.add(listener);
  latestProbe = probe;
  installLifecycleListeners();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      cancelCurrentProbe();
      latestProbe = undefined;
      removeLifecycleListeners();
    }
  };
}

/**
 * Start a cold auth bootstrap. Its result alone may commit; explicit
 * invalidations, unmounts, and newer probes abort or supersede all older work.
 */
export function bootstrapAuthSession(probe: AuthProbe): void {
  void runAuthProbe(probe, false);
}

/**
 * Revalidate an established session without exposing probe progress to the
 * protected tree. Only definitive invalidation ends the established session.
 */
export function revalidateAuthSession(probe: AuthProbe): void {
  if (!establishedSession || snapshot.status !== "active") return;
  void runAuthProbe(probe, true);
}

/** Retry an unavailable result while keeping the current surface mounted. */
export function retryAuthSession(probe: AuthProbe): Promise<void> {
  if (currentProbe) return Promise.resolve();
  return runAuthProbe(probe, true);
}

/** Start cold bootstrap when no probe or established session is current. */
export function ensureAuthSession(probe: AuthProbe): void {
  latestProbe = probe;
  if (establishedSession || currentProbe) return;
  bootstrapAuthSession(probe);
}

async function runAuthProbe(
  probe: AuthProbe,
  background: boolean,
): Promise<void> {
  latestProbe = probe;
  cancelCurrentProbe();

  const probeGeneration = generation;
  const controller = new AbortController();
  currentProbe = { controller, generation: probeGeneration };
  if (!background) setStatus("checking");

  try {
    for (let attempt = 0; attempt < AUTH_PROBE_MAX_ATTEMPTS; attempt += 1) {
      if (probeGeneration !== generation || controller.signal.aborted) return;

      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
      ]);
      const result = await probeUntilSettled(probe, signal);
      if (probeGeneration !== generation || controller.signal.aborted) return;

      if (result.state !== "unavailable") {
        setStatus(
          result.state,
          result.state === "inactive" ? result : undefined,
        );
        return;
      }

      if (attempt + 1 === AUTH_PROBE_MAX_ATTEMPTS) {
        setStatus("unavailable");
        return;
      }
      await waitBeforeRetry(AUTH_PROBE_RETRY_DELAY_MS, controller.signal);
    }
  } finally {
    if (currentProbe?.generation === probeGeneration) {
      currentProbe = undefined;
    }
  }
}

function probeUntilSettled(
  probe: AuthProbe,
  signal: AbortSignal,
): Promise<AkbSessionStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AkbSessionStatus) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ state: "unavailable" });

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      void probe(signal).then(finish, () => finish({ state: "unavailable" }));
    } catch {
      finish({ state: "unavailable" });
    }
  });
}

function waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Mark the session unusable and synchronously notify every mounted guard. */
export function invalidateAuthSession(): void {
  cancelCurrentProbe();
  setStatus("inactive");
}

/** Test-specific cleanup for the module-level coordinator. */
export function __resetAuthCoordinatorForTests(): void {
  cancelCurrentProbe();
  listeners.clear();
  latestProbe = undefined;
  removeLifecycleListeners();
  generation = 0;
  establishedSession = false;
  snapshot = INITIAL_SNAPSHOT;
}
