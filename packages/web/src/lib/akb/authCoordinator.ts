import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import type { AkbAccountErrorCode } from "@reef/core";
import type { AkbSessionStatus } from "./authSessionStatus";

/**
 * The maximum time a browser auth probe may keep a protected surface in the
 * checking state. A stalled AKB/network request is an authentication failure
 * from the browser's point of view: fail closed and let the mounted guard
 * converge on the safe login route.
 */
export const AUTH_PROBE_TIMEOUT_MS = 5_000;

export type AuthCoordinatorStatus = "checking" | "active" | "inactive";

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
  result?: Extract<AkbSessionStatus, { active: false }>,
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
 * Start a cold auth bootstrap. Only its result may commit; explicit
 * invalidations, unmounts, and newer probes abort or supersede all older work.
 */
export function bootstrapAuthSession(probe: AuthProbe): void {
  runAuthProbe(probe, false);
}

/**
 * Revalidate an established session without exposing probe progress to the
 * protected tree. An inactive or timed-out result still commits immediately so
 * the mounted guard can converge on the safe login route.
 */
export function revalidateAuthSession(probe: AuthProbe): void {
  if (!establishedSession || snapshot.status !== "active") return;
  runAuthProbe(probe, true);
}

/** Start cold bootstrap only when no probe or established session is current. */
export function ensureAuthSession(probe: AuthProbe): void {
  latestProbe = probe;
  if (establishedSession || currentProbe) return;
  bootstrapAuthSession(probe);
}

function runAuthProbe(probe: AuthProbe, background: boolean): void {
  latestProbe = probe;
  cancelCurrentProbe();

  const probeGeneration = generation;
  const controller = new AbortController();
  currentProbe = { controller, generation: probeGeneration };
  if (!background) setStatus("checking");
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
  ]);

  void (async () => {
    try {
      const result = await probe(signal);
      if (probeGeneration !== generation || controller.signal.aborted) return;
      setStatus(
        result.active ? "active" : "inactive",
        result.active ? undefined : result,
      );
    } catch {
      if (probeGeneration !== generation || controller.signal.aborted) return;
      setStatus("inactive");
    } finally {
      if (currentProbe?.generation === probeGeneration) {
        currentProbe = undefined;
      }
    }
  })();
}

/** Mark the session unusable and synchronously notify every mounted guard. */
export function invalidateAuthSession(): void {
  cancelCurrentProbe();
  setStatus("inactive");
}

/** Test-only cleanup for the module-level coordinator. */
export function __resetAuthCoordinatorForTests(): void {
  cancelCurrentProbe();
  listeners.clear();
  latestProbe = undefined;
  removeLifecycleListeners();
  generation = 0;
  establishedSession = false;
  snapshot = INITIAL_SNAPSHOT;
}
