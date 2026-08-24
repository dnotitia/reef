import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_PROBE_TIMEOUT_MS,
  __resetAuthCoordinatorForTests,
  hasEstablishedAuthSession,
  requestAuthProbe,
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

    requestAuthProbe(firstProbe);
    const firstSignal = firstProbe.mock.calls[0]?.[0] as AbortSignal;
    requestAuthProbe(secondProbe);
    resolveFirst(inactive);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstSignal.aborted).toBe(true);
    expect(secondProbe).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe("active");
    unsubscribe();
  });

  it("fails closed and aborts a probe at the bounded timeout", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(
      (_signal: AbortSignal) => new Promise<typeof active>(() => {}),
    );
    const states: string[] = [];
    const unsubscribe = subscribeAuthCoordinator(
      (snapshot) => states.push(snapshot.status),
      probe,
    );

    requestAuthProbe(probe);
    await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS);

    const signal = probe.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(states.at(-1)).toBe("inactive");
    unsubscribe();
  });

  it("turns AUTH_CHANGED_EVENT into an immediate inactive transition", async () => {
    const probe = vi.fn(async () => active);
    const states: string[] = [];
    const unsubscribe = subscribeAuthCoordinator(
      (snapshot) => states.push(snapshot.status),
      probe,
    );

    requestAuthProbe(probe);
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

    requestAuthProbe(probe);
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

    requestAuthProbe(activeProbe);
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

    requestAuthProbe(revalidationProbe);
    expect(hasEstablishedAuthSession()).toBe(true);

    resolveRevalidation(inactive);
    await Promise.resolve();
    await Promise.resolve();
    expect(hasEstablishedAuthSession()).toBe(false);
    unsubscribe();
  });
});
