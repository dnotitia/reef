import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingAkbAccountError,
  peekPendingAkbAccountError,
  recordAkbAccountDenial,
  subscribeAkbAccountDenied,
} from "./accountDenialClient";

describe("accountDenialClient", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists and broadcasts a stable account denial once", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeAkbAccountDenied(handler);

    recordAkbAccountDenial("membership_required");

    expect(handler).toHaveBeenCalledWith("membership_required");
    expect(peekPendingAkbAccountError()).toBe("membership_required");
    expect(peekPendingAkbAccountError()).toBe("membership_required");
    expect(consumePendingAkbAccountError()).toBe("membership_required");
    expect(consumePendingAkbAccountError()).toBeUndefined();
    unsubscribe();
  });

  it("ignores an unknown account code", () => {
    recordAkbAccountDenial("unknown");

    expect(consumePendingAkbAccountError()).toBeUndefined();
  });
});
