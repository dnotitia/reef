import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingAkbAccountError,
  consumePendingAkbAccountErrorIfUnchanged,
  isAkbAccountDenialTokenCleared,
  peekPendingAkbAccountError,
  recordAkbAccountDenial,
  recordAkbAccountDenialIfUnchanged,
  snapshotPendingAkbAccountError,
  subscribeAkbAccountDenialCleared,
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

    expect(handler).toHaveBeenCalledWith(
      "membership_required",
      expect.objectContaining({
        code: "membership_required",
        token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
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

  it("does not let an older probe consume a newer denial record", () => {
    recordAkbAccountDenial("membership_required");
    const olderSnapshot = snapshotPendingAkbAccountError();
    recordAkbAccountDenial("membership_required");

    expect(
      consumePendingAkbAccountErrorIfUnchanged(olderSnapshot),
    ).toBeUndefined();
    expect(peekPendingAkbAccountError()).toBe("membership_required");
  });

  it("replaces only the denial record observed when a probe began", () => {
    recordAkbAccountDenial("membership_required");
    const probeSnapshot = snapshotPendingAkbAccountError();

    const selected = recordAkbAccountDenialIfUnchanged(
      "account_suspended",
      probeSnapshot,
    );

    expect(selected).toEqual(
      expect.objectContaining({ code: "account_suspended" }),
    );
    expect(selected?.token).not.toBe(probeSnapshot?.token);
  });

  it("preserves a denial recorded while a probe is in flight", () => {
    recordAkbAccountDenial("membership_required");
    const probeSnapshot = snapshotPendingAkbAccountError();
    recordAkbAccountDenial("identity_conflict");

    const selected = recordAkbAccountDenialIfUnchanged(
      "account_suspended",
      probeSnapshot,
    );

    expect(selected).toEqual(snapshotPendingAkbAccountError());
    expect(selected?.code).toBe("identity_conflict");
  });

  it("records a denial after a concurrent successful probe clears storage", () => {
    recordAkbAccountDenial("membership_required");
    const probeSnapshot = snapshotPendingAkbAccountError();
    consumePendingAkbAccountErrorIfUnchanged(probeSnapshot);

    const selected = recordAkbAccountDenialIfUnchanged(
      "account_suspended",
      probeSnapshot,
    );

    expect(selected).toEqual(
      expect.objectContaining({ code: "account_suspended" }),
    );
    expect(peekPendingAkbAccountError()).toBe("account_suspended");
  });

  it("broadcasts the exact denial token cleared by a successful probe", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeAkbAccountDenialCleared(handler);
    recordAkbAccountDenial("membership_required");
    const snapshot = snapshotPendingAkbAccountError();

    consumePendingAkbAccountErrorIfUnchanged(snapshot);

    expect(handler).toHaveBeenCalledWith(snapshot);
    unsubscribe();
  });

  it("broadcasts a fresh snapshot when storage cannot replace stale state", () => {
    recordAkbAccountDenial("membership_required");
    const stale = snapshotPendingAkbAccountError();
    const handler = vi.fn();
    const unsubscribe = subscribeAkbAccountDenied(handler);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    recordAkbAccountDenial("account_suspended");

    const liveSnapshot = handler.mock.calls[0]?.[1];
    expect(handler).toHaveBeenCalledWith(
      "account_suspended",
      expect.objectContaining({ code: "account_suspended" }),
    );
    expect(snapshotPendingAkbAccountError()).toEqual(liveSnapshot);
    expect(isAkbAccountDenialTokenCleared(stale?.token ?? "")).toBe(true);
    expect(consumePendingAkbAccountErrorIfUnchanged(liveSnapshot)).toBe(
      "account_suspended",
    );
    expect(isAkbAccountDenialTokenCleared(liveSnapshot?.token ?? "")).toBe(
      true,
    );
    unsubscribe();
  });

  it("merges persisted invalidated tokens before writing a new one", () => {
    const persistedToken = "persisted-before-reload";
    sessionStorage.setItem(
      "reef:invalidated-akb-account-error-tokens",
      JSON.stringify([persistedToken]),
    );
    recordAkbAccountDenial("membership_required");
    const pending = snapshotPendingAkbAccountError();

    consumePendingAkbAccountErrorIfUnchanged(pending);

    const stored = JSON.parse(
      sessionStorage.getItem("reef:invalidated-akb-account-error-tokens") ??
        "[]",
    ) as unknown[];
    expect(stored).toContain(persistedToken);
    expect(stored).toContain(pending?.token);
  });

  it("clears a volatile denial when all session storage writes are blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    recordAkbAccountDenial("membership_required");
    const pending = snapshotPendingAkbAccountError();
    const cleared = vi.fn();
    const unsubscribe = subscribeAkbAccountDenialCleared(cleared);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });

    expect(consumePendingAkbAccountErrorIfUnchanged(pending)).toBe(
      "membership_required",
    );

    expect(snapshotPendingAkbAccountError()).toBeUndefined();
    expect(isAkbAccountDenialTokenCleared(pending?.token ?? "")).toBe(true);
    expect(cleared).toHaveBeenCalledWith(pending);
    unsubscribe();
  });

  it("replaces a volatile denial when all session storage writes are blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    recordAkbAccountDenial("membership_required");
    const pending = snapshotPendingAkbAccountError();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });

    const replacement = recordAkbAccountDenialIfUnchanged(
      "account_suspended",
      pending,
    );

    expect(replacement).toEqual(
      expect.objectContaining({ code: "account_suspended" }),
    );
    expect(replacement?.token).not.toBe(pending?.token);
    expect(snapshotPendingAkbAccountError()).toEqual(replacement);
    consumePendingAkbAccountErrorIfUnchanged(replacement);
  });

  it("keeps superseded and cleared generations invalidated", () => {
    recordAkbAccountDenial("membership_required");
    const first = snapshotPendingAkbAccountError();
    recordAkbAccountDenial("account_suspended");
    const second = snapshotPendingAkbAccountError();

    expect(isAkbAccountDenialTokenCleared(first?.token ?? "")).toBe(true);
    consumePendingAkbAccountErrorIfUnchanged(second);
    expect(isAkbAccountDenialTokenCleared(second?.token ?? "")).toBe(true);
  });
});
