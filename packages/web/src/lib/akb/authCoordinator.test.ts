import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_PROBE_TIMEOUT_MS,
  AUTH_PROBE_RETRY_DELAY_MS,
  __resetAuthCoordinatorForTests,
  getAuthCoordinatorSnapshot,
  hasEstablishedAuthSession,
  bootstrapAuthSession,
  revalidateAuthSession,
  subscribeAuthCoordinator,
} from "./authCoordinator";

const active = { state: "active" } as const;
const inactive = { state: "inactive" } as const;
const unavailable = { state: "unavailable" } as const;

describe("auth coordinator", () => {
  beforeEach(() => {
    __resetAuthCoordinatorForTests();
  });

  afterEach(() => {
    __resetAuthCoordinatorForTests();
    vi.useRealTimers();
  });

  it("commits only the newest probe result and aborts the previous probe", async () => {
    let resolveFirst!: (
      value: typeof active | typeof inactive | typeof unavailable,
    ) => void;
    const first = new Promise<
      typeof active | typeof inactive | typeof unavailable
    >((resolve) => {
      resolveFirst = resolve;
    });
    const firstProbe = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return first;
    });
    const secondProbe = vi.fn(async () => active);
    const states: string[] = [];
    const unsubscribe = subscribeAuthCoordinator(
      (snapshot) => states.push(snapshot.status),
      firstProbe,
    );

    bootstrapAuthSession(firstProbe);
    const firstSignal = firstProbe.mock.calls[0]?.[0] as AbortSignal;
    bootstrapAuthSession(secondProbe);
    resolveFirst(inactive);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstSignal.aborted).toBe(true);
    expect(secondProbe).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe("active");
    unsubscribe();
  });

  it("reports unavailable rather than unauthenticated after bounded probe timeouts", async () => {
    vi.useFakeTimers();
    const timeoutControllers: AbortController[] = [];
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => {
        const timeout = new AbortController();
        timeoutControllers.push(timeout);
        return timeout.signal;
      });
    const probe = vi.fn(
      (signal: AbortSignal) =>
        new Promise<typeof unavailable>((resolve) => {
          signal.addEventListener("abort", () => resolve(unavailable), {
            once: true,
          });
        }),
    );
    const states: string[] = [];
    const unsubscribe = subscribeAuthCoordinator(
      (snapshot) => states.push(snapshot.status),
      probe,
    );

    bootstrapAuthSession(probe);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(AUTH_PROBE_TIMEOUT_MS);
    timeoutControllers[0]?.abort(new DOMException("Timed out", "TimeoutError"));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(AUTH_PROBE_RETRY_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    timeoutControllers[1]?.abort(new DOMException("Timed out", "TimeoutError"));
    await Promise.resolve();
    await Promise.resolve();

    expect(probe).toHaveBeenCalledTimes(2);
    expect(getAuthCoordinatorSnapshot().status).toBe("unavailable");
    expect(states.at(-1)).toBe("unavailable");
    unsubscribe();
    timeoutSpy.mockRestore();
  });

  it("retries an unavailable probe once and keeps the retry count finite", async () => {
    vi.useFakeTimers();
    const probe = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable);
    const unsubscribe = subscribeAuthCoordinator(() => {}, probe);

    bootstrapAuthSession(probe);
    await Promise.resolve();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTH_PROBE_RETRY_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(probe).toHaveBeenCalledTimes(2);
    expect(getAuthCoordinatorSnapshot().status).toBe("unavailable");
    expect(hasEstablishedAuthSession()).toBe(false);
    unsubscribe();
  });

  it("turns AUTH_CHANGED_EVENT into an immediate inactive transition", async () => {
    const probe = vi.fn(async () => active);
    const states: string[] = [];
    const unsubscribe = subscribeAuthCoordinator(
      (snapshot) => states.push(snapshot.status),
      probe,
    );

    bootstrapAuthSession(probe);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toBe("active");

    window.dispatchEvent(new Event("reef:auth-changed"));

    expect(states.at(-1)).toBe("inactive");
    unsubscribe();
  });

  it("revalidates an active session when the tab regains focus", async () => {
    const probe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, probe);

    bootstrapAuthSession(probe);
    await Promise.resolve();
    await Promise.resolve();
    probe.mockClear();

    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    await Promise.resolve();

    expect(probe).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("keeps the established-session marker during revalidation", async () => {
    const activeProbe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, activeProbe);

    bootstrapAuthSession(activeProbe);
    await Promise.resolve();
    await Promise.resolve();
    expect(hasEstablishedAuthSession()).toBe(true);

    let resolveRevalidation!: (
      value: typeof active | typeof inactive | typeof unavailable,
    ) => void;
    const revalidation = new Promise<
      typeof active | typeof inactive | typeof unavailable
    >((resolve) => {
      resolveRevalidation = resolve;
    });
    const revalidationProbe = vi.fn(() => revalidation);

    revalidateAuthSession(revalidationProbe);
    expect(hasEstablishedAuthSession()).toBe(true);

    resolveRevalidation(inactive);
    await Promise.resolve();
    await Promise.resolve();
    expect(hasEstablishedAuthSession()).toBe(false);
    unsubscribe();
  });

  it("preserves an established session when background revalidation is unavailable", async () => {
    vi.useFakeTimers();
    const activeProbe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, activeProbe);

    bootstrapAuthSession(activeProbe);
    await Promise.resolve();
    await Promise.resolve();
    expect(hasEstablishedAuthSession()).toBe(true);

    const unavailableProbe = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(unavailable);
    revalidateAuthSession(unavailableProbe);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(AUTH_PROBE_RETRY_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(unavailableProbe).toHaveBeenCalledTimes(2);
    expect(getAuthCoordinatorSnapshot().status).toBe("unavailable");
    expect(hasEstablishedAuthSession()).toBe(true);
    unsubscribe();
  });

  it("keeps an established session active while background revalidation is pending", async () => {
    const activeProbe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, activeProbe);

    bootstrapAuthSession(activeProbe);
    await Promise.resolve();
    await Promise.resolve();

    let resolveRevalidation!: (
      value: typeof active | typeof unavailable,
    ) => void;
    const revalidation = new Promise<typeof active | typeof unavailable>(
      (resolve) => {
        resolveRevalidation = resolve;
      },
    );
    const revalidationProbe = vi.fn(() => revalidation);

    revalidateAuthSession(revalidationProbe);

    expect(revalidationProbe).toHaveBeenCalledOnce();
    expect(getAuthCoordinatorSnapshot().status).toBe("active");

    resolveRevalidation(active);
    await Promise.resolve();
    await Promise.resolve();
    expect(getAuthCoordinatorSnapshot().status).toBe("active");
    unsubscribe();
  });

  it("does not restore an invalidated session from a late successful probe", async () => {
    const activeProbe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, activeProbe);

    bootstrapAuthSession(activeProbe);
    await Promise.resolve();
    await Promise.resolve();
    let resolveStale!: (value: typeof active) => void;
    const staleProbe = vi.fn(
      () =>
        new Promise<typeof active>((resolve) => {
          resolveStale = resolve;
        }),
    );
    revalidateAuthSession(staleProbe);
    window.dispatchEvent(new Event("reef:auth-changed"));
    resolveStale(active);
    await Promise.resolve();
    await Promise.resolve();

    expect(getAuthCoordinatorSnapshot().status).toBe("inactive");
    expect(hasEstablishedAuthSession()).toBe(false);
    unsubscribe();
  });
});
