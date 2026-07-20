// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
const consumePendingAkbAccountError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/apiClient", () => ({ apiFetch }));
vi.mock("./accountDenialClient", () => ({
  consumePendingAkbAccountError: () => consumePendingAkbAccountError(),
}));

import { getAkbSessionStatus, hasActiveAkbSession } from "./checkAkbSession";

describe("getAkbSessionStatus", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    consumePendingAkbAccountError.mockReset();
  });

  it("reports an active session for a successful profile response", async () => {
    apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(getAkbSessionStatus()).resolves.toEqual({ active: true });
    await expect(hasActiveAkbSession()).resolves.toBe(true);
  });

  it("preserves a stable AKB account denial code", async () => {
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
    });
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
    consumePendingAkbAccountError.mockReturnValue("account_suspended");

    await expect(getAkbSessionStatus()).resolves.toEqual({
      active: false,
      accountError: "account_suspended",
    });
  });

  it("treats network failures as an inactive session", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));

    await expect(getAkbSessionStatus()).resolves.toEqual({ active: false });
  });
});
