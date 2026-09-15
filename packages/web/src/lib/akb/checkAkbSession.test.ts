// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
const consumePendingAkbAccountErrorIfUnchanged = vi.hoisted(() => vi.fn());
const recordAkbAccountDenialIfUnchanged = vi.hoisted(() => vi.fn());
const snapshotPendingAkbAccountError = vi.hoisted(() => vi.fn());
const hasEstablishedAuthSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/apiClient", () => ({ apiFetch }));
vi.mock("@/lib/akb/authCoordinator", () => ({ hasEstablishedAuthSession }));
vi.mock("./accountDenialClient", () => ({
  consumePendingAkbAccountErrorIfUnchanged: (snapshot: unknown) =>
    consumePendingAkbAccountErrorIfUnchanged(snapshot),
  recordAkbAccountDenialIfUnchanged: (value: unknown, snapshot: unknown) =>
    recordAkbAccountDenialIfUnchanged(value, snapshot),
  snapshotPendingAkbAccountError: () => snapshotPendingAkbAccountError(),
}));

import { getAkbSessionStatus } from "./checkAkbSession";

describe("getAkbSessionStatus", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    consumePendingAkbAccountErrorIfUnchanged.mockReset();
    recordAkbAccountDenialIfUnchanged.mockReset();
    snapshotPendingAkbAccountError.mockReset();
    hasEstablishedAuthSession.mockReset();
    hasEstablishedAuthSession.mockReturnValue(false);
  });

  it("reports an active session for a successful profile response", async () => {
    const snapshot = { code: "account_suspended", token: "denial-4" };
    snapshotPendingAkbAccountError
      .mockReturnValueOnce(snapshot)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(snapshot)
      .mockReturnValueOnce(undefined);
    apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getAkbSessionStatus()).resolves.toEqual({ state: "active" });
    expect(consumePendingAkbAccountErrorIfUnchanged).toHaveBeenCalledWith(
      snapshot,
    );
  });

  it("reports a denial recorded while a successful probe is in flight", async () => {
    const probeSnapshot = { code: "membership_required", token: "denial-10" };
    const newerDenial = { code: "account_suspended", token: "denial-11" };
    snapshotPendingAkbAccountError
      .mockReturnValueOnce(probeSnapshot)
      .mockReturnValueOnce(newerDenial);
    apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getAkbSessionStatus()).resolves.toEqual({
      state: "inactive",
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
      state: "inactive",
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
      state: "inactive",
      accountError: "identity_conflict",
      accountErrorToken: "denial-7",
    });
    expect(recordAkbAccountDenialIfUnchanged).toHaveBeenCalledWith(
      "account_suspended",
      probeSnapshot,
    );
  });

  it("treats a first-visit 401 as definitively unauthenticated", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ error: "No session.", code: "unknown" }, { status: 401 }),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({ state: "inactive" });
  });

  it("does not turn a status-only established-session 401 into logout", async () => {
    hasEstablishedAuthSession.mockReturnValue(true);
    apiFetch.mockResolvedValue(
      Response.json({ error: "Unauthorized." }, { status: 401 }),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({
      state: "unavailable",
    });
  });

  it.each([403, 409, 500, 502, 503])(
    "classifies status-only %i responses as unavailable",
    async (status) => {
      hasEstablishedAuthSession.mockReturnValue(true);
      apiFetch.mockResolvedValue(
        Response.json({ error: "Temporary probe failure." }, { status }),
      );

      await expect(getAkbSessionStatus()).resolves.toEqual({
        state: "unavailable",
      });
    },
  );

  it("honors an explicit server invalidation signal", async () => {
    apiFetch.mockResolvedValue(
      new Response(null, {
        status: 401,
        headers: { "x-reef-auth-invalidated": "1" },
      }),
    );

    await expect(getAkbSessionStatus()).resolves.toEqual({ state: "inactive" });
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
      state: "inactive",
      accountError: "account_suspended",
      accountErrorToken: "denial-8",
    });
  });

  it("treats network failures as unavailable", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));

    await expect(getAkbSessionStatus()).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("preserves a pending denial when a concurrent session probe fails", async () => {
    apiFetch.mockRejectedValue(new Error("aborted by navigation"));
    snapshotPendingAkbAccountError.mockReturnValue({
      code: "identity_conflict",
      token: "denial-9",
    });

    await expect(getAkbSessionStatus()).resolves.toEqual({
      state: "inactive",
      accountError: "identity_conflict",
      accountErrorToken: "denial-9",
    });
  });
});
