import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, ControlPlaneError } from "../../../errors";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { listAdminActiveInstallations } from "./installationInventoryReader";

const appId = "11111111-1111-4111-8111-111111111111";
function item(index: number, app = appId) {
  return {
    installation_id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
    app_id: app,
    vault_id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    vault_name: `reef-${index}`,
    lifecycle: "active",
    owned_resources: [{ private: "not-public" }],
  };
}

describe("user-authenticated admin installation inventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads every page through the user adapter and strips private fields", async () => {
    const { calls } = setupFetch([
      { body: { items: [item(1)], next_cursor: "next/page" } },
      { body: { items: [item(2)], next_cursor: null } },
    ]);
    const result = await listAdminActiveInstallations({
      adapter: makeTestAkbAdapter(),
      appId,
    });
    expect(result.map((entry) => entry.vaultName)).toEqual([
      "reef-1",
      "reef-2",
    ]);
    expect(JSON.stringify(result)).not.toContain("not-public");
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0].url);
    expect(first.pathname).toBe(`/api/v1/apps/${appId}/inventory`);
    expect(first.searchParams.get("limit")).toBe("200");
    expect(first.searchParams.get("lifecycle")).toBe("active");
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("next/page");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toMatch(
      /^Bearer /,
    );
  });

  it.each(["other-app", "duplicate-vault", "repeated-cursor"])(
    "rejects an inconsistent %s snapshot",
    async (mode) => {
      const second =
        mode === "other-app"
          ? item(2, "99999999-9999-4999-8999-999999999999")
          : item(mode === "duplicate-vault" ? 1 : 2);
      setupFetch([
        { body: { items: [item(1)], next_cursor: "next" } },
        {
          body: {
            items: [second],
            next_cursor: mode === "repeated-cursor" ? "next" : null,
          },
        },
      ]);
      await expect(
        listAdminActiveInstallations({ adapter: makeTestAkbAdapter(), appId }),
      ).rejects.toBeInstanceOf(ControlPlaneError);
    },
  );

  it("preserves an authoritative AKB account denial", async () => {
    setupFetch([
      { status: 403, body: { detail: { code: "account_suspended" } } },
    ]);
    await expect(
      listAdminActiveInstallations({ adapter: makeTestAkbAdapter(), appId }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
