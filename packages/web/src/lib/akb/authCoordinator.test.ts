import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_PROBE_TIMEOUT_MS,
  __resetAuthCoordinatorForTests,
  getAuthCoordinatorSnapshot,
  hasEstablishedAuthSession,
  bootstrapAuthSession,
  revalidateAuthSession,
  subscribeAuthCoordinator,
} from "./authCoordinator";

const active = { active: true } as const;
const inactive = { active: false } as const;

describe("auth coordinator", () => {
  beforeEach(() => {
    __resetAuthCoordinatorForTests();
  });

  afterEach(() => {
    __resetAuthCoordinatorForTests();
    vi.useRealTimers();
  });

  it("commits only the newest probe result and aborts the previous probe", async () => {
    let resolveFirst!: (value: typeof active | typeof inactive) => void;
    const first = new Promise<typeof active | typeof inactive>((resolve) => {
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

  it("fails closed and aborts a probe at the bounded timeout", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    const probe = vi.fn(
      (signal: AbortSignal) =>
        new Promise<typeof active>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
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
    timeout.abort(new DOMException("Timed out", "TimeoutError"));
    await Promise.resolve();
    await Promise.resolve();

    const signal = probe.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(states.at(-1)).toBe("inactive");
    unsubscribe();
    timeoutSpy.mockRestore();
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

    let resolveRevalidation!: (value: typeof active | typeof inactive) => void;
    const revalidation = new Promise<typeof active | typeof inactive>(
      (resolve) => {
        resolveRevalidation = resolve;
      },
    );
    const revalidationProbe = vi.fn(() => revalidation);

    revalidateAuthSession(revalidationProbe);
    expect(hasEstablishedAuthSession()).toBe(true);

    resolveRevalidation(inactive);
    await Promise.resolve();
    await Promise.resolve();
    expect(hasEstablishedAuthSession()).toBe(false);
    unsubscribe();
  });

  it("keeps an established session active while background revalidation is pending", async () => {
    const activeProbe = vi.fn(async () => active);
    const unsubscribe = subscribeAuthCoordinator(() => {}, activeProbe);

    bootstrapAuthSession(activeProbe);
    await Promise.resolve();
    await Promise.resolve();

    let resolveRevalidation!: (value: typeof active) => void;
    const revalidation = new Promise<typeof active>((resolve) => {
      resolveRevalidation = resolve;
    });
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
});
