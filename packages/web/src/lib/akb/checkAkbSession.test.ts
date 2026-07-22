// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
const consumePendingAkbAccountErrorIfUnchanged = vi.hoisted(() => vi.fn());
const recordAkbAccountDenialIfUnchanged = vi.hoisted(() => vi.fn());
const snapshotPendingAkbAccountError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/apiClient", () => ({ apiFetch }));
vi.mock("./accountDenialClient", () => ({
  consumePendingAkbAccountErrorIfUnchanged: (snapshot: unknown) =>
    consumePendingAkbAccountErrorIfUnchanged(snapshot),
  recordAkbAccountDenialIfUnchanged: (value: unknown, snapshot: unknown) =>
    recordAkbAccountDenialIfUnchanged(value, snapshot),
  snapshotPendingAkbAccountError: () => snapshotPendingAkbAccountError(),
}));

import { getAkbSessionStatus, hasActiveAkbSession } from "./checkAkbSession";

describe("getAkbSessionStatus", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    consumePendingAkbAccountErrorIfUnchanged.mockReset();
    recordAkbAccountDenialIfUnchanged.mockReset();
    snapshotPendingAkbAccountError.mockReset();
  });

  it("reports an active session for a successful profile response", async () => {
    const snapshot = { code: "account_suspended", token: "denial-4" };
    snapshotPendingAkbAccountError
      .mockReturnValueOnce(snapshot)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(snapshot)
      .mockReturnValueOnce(undefined);
    apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getAkbSessionStatus()).resolves.toEqual({ active: true });
    expect(consumePendingAkbAccountErrorIfUnchanged).toHaveBeenCalledWith(
      snapshot,
    );
    await expect(hasActiveAkbSession()).resolves.toBe(true);
  });

  it("reports a denial recorded while a successful probe is in flight", async () => {
    const probeSnapshot = { code: "membership_required", token: "denial-10" };
    const newerDenial = { code: "account_suspended", token: "denial-11" };
    snapshotPendingAkbAccountError
      .mockReturnValueOnce(probeSnapshot)
      .mockReturnValueOnce(newerDenial);
    apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "account_suspended",
      accountErrorToken: "denial-11",
    });
  });

  it("preserves a stable AKB account denial code", async () => {
    recordAkbAccountDenialIfUnchanged.mockReturnValue({
      code: "membership_required",
      token: "denial-5",
    });
    apiFetch.mockResolvedValue(
      Response.json(
        {
          error: "Workspace membership is required.",
          code: "membership_required",
        },
        { status: 401 },
      ),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "membership_required",
      accountErrorToken: "denial-5",
    });
  });

  it("keeps a denial recorded while the profile probe is in flight", async () => {
    const probeSnapshot = { code: "membership_required", token: "denial-6" };
    snapshotPendingAkbAccountError.mockReturnValue(probeSnapshot);
    recordAkbAccountDenialIfUnchanged.mockReturnValue({
      code: "identity_conflict",
      token: "denial-7",
    });
    apiFetch.mockResolvedValue(
      Response.json({ code: "account_suspended" }, { status: 401 }),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "identity_conflict",
      accountErrorToken: "denial-7",
    });
    expect(recordAkbAccountDenialIfUnchanged).toHaveBeenCalledWith(
      "account_suspended",
      probeSnapshot,
    );
  });

  it("does not trust an unknown response code", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ error: "No session.", code: "unknown" }, { status: 401 }),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({ active: false });
  });

  it("recovers a denial consumed by an earlier protected request", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ error: "No session." }, { status: 401 }),
    );
    snapshotPendingAkbAccountError.mockReturnValue({
      code: "account_suspended",
      token: "denial-8",
    });

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "account_suspended",
      accountErrorToken: "denial-8",
    });
  });

  it("treats network failures as an inactive session", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));

    await expect(getAkbSessionStatus()).resolves.toEqual({ active: false });
  });

  it("preserves a pending denial when a concurrent session probe fails", async () => {
    apiFetch.mockRejectedValue(new Error("aborted by navigation"));
    snapshotPendingAkbAccountError.mockReturnValue({
      code: "identity_conflict",
      token: "denial-9",
    });

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "identity_conflict",
      accountErrorToken: "denial-9",
    });
  });
});
