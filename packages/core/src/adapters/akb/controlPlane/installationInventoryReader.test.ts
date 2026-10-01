import { describe, expect, it, vi } from "vitest";
import { ControlPlaneError } from "../../../errors";
import { createAkbAppInstallationInventoryReader } from "./installationInventoryReader";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_APP_ID = "99999999-9999-4999-8999-999999999999";
const VAULT_A_ID = "22222222-2222-4222-8222-222222222222";
const VAULT_B_ID = "33333333-3333-4333-8333-333333333333";
const INSTALLATION_A_ID = "44444444-4444-4444-8444-444444444444";
const INSTALLATION_B_ID = "55555555-5555-4555-8555-555555555555";
const SECRET = "private-inventory-marker";
const APP_TOKEN = "short-lived-app-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse({
    access_token: APP_TOKEN,
    token_type: "Bearer",
    expires_in: 300,
    expires_at: "2026-10-01T08:00:00.000Z",
  });
}

function inventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: INSTALLATION_A_ID,
    app_id: APP_ID,
    vault_id: VAULT_A_ID,
    vault_name: "reef_test",
    lifecycle: "active",
    owned_resources: [{ key: SECRET }],
    checkpoint: { cursor: SECRET },
    recent_error: { message: SECRET },
    ...overrides,
  };
}

function makeReader(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected inventory request");
      return response;
    },
  );
  const reader = createAkbAppInstallationInventoryReader({
    baseUrl: "https://akb.example.test/api/v1///",
    appCredential: "app-credential",
    fetch,
  });
  return { reader, calls, fetch };
}

describe("createAkbAppInstallationInventoryReader", () => {
  it("reads every active inventory page and returns only the public identity", async () => {
    const { reader, calls } = makeReader([
      tokenResponse(),
      jsonResponse({
        items: [inventoryItem()],
        next_cursor: "opaque/page-two",
      }),
      jsonResponse({
        items: [
          inventoryItem({
            installation_id: INSTALLATION_B_ID,
            vault_id: VAULT_B_ID,
            vault_name: "workspace_main",
          }),
        ],
        next_cursor: null,
      }),
    ]);

    const result = await reader.listActiveInstallations();

    expect(Object.keys(reader)).toEqual(["listActiveInstallations"]);
    expect(calls).toHaveLength(3);
    const exchange = calls[0];
    expect(new URL(exchange.url).pathname).toBe("/api/v1/auth/app-token");
    expect(exchange.init.method).toBe("POST");
    expect(exchange.init.body).toBe(
      JSON.stringify({ credential: "app-credential" }),
    );
    expect(Object.fromEntries(new Headers(exchange.init.headers))).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(new Headers(exchange.init.headers).has("authorization")).toBe(false);
    const firstUrl = new URL(calls[1].url);
    expect(firstUrl.pathname).toBe("/api/v1/app/inventory");
    expect(firstUrl.searchParams.get("limit")).toBe("200");
    expect(firstUrl.searchParams.get("lifecycle")).toBe("active");
    const secondUrl = new URL(calls[2].url);
    expect(secondUrl.searchParams.get("cursor")).toBe("opaque/page-two");
    expect(secondUrl.searchParams.get("limit")).toBe("200");
    expect(secondUrl.searchParams.get("lifecycle")).toBe("active");
    for (const call of calls.slice(1)) {
      expect(call.init.method).toBe("GET");
      expect(call.init.body).toBeUndefined();
      expect(Object.fromEntries(new Headers(call.init.headers))).toEqual({
        accept: "application/json",
        authorization: `Bearer ${APP_TOKEN}`,
      });
      expect(new URL(call.url).pathname).not.toContain("/apps/");
    }

    expect(result).toEqual([
      {
        installationId: INSTALLATION_A_ID,
        appId: APP_ID,
        vaultId: VAULT_A_ID,
        vaultName: "reef_test",
        lifecycle: "active",
      },
      {
        installationId: INSTALLATION_B_ID,
        appId: APP_ID,
        vaultId: VAULT_B_ID,
        vaultName: "workspace_main",
        lifecycle: "active",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("fails closed when later pages change app identity or repeat a cursor", async () => {
    const mixedApp = makeReader([
      tokenResponse(),
      jsonResponse({ items: [inventoryItem()], next_cursor: "next" }),
      jsonResponse({
        items: [inventoryItem({ app_id: OTHER_APP_ID })],
        next_cursor: null,
      }),
    ]);
    const mixedAppError = await mixedApp.reader
      .listActiveInstallations()
      .catch((error) => error);
    expect(mixedAppError).toBeInstanceOf(ControlPlaneError);
    expect(mixedAppError).toMatchObject({
      category: "invalid_response",
      upstreamStatus: 200,
      retryable: true,
    });

    const repeatedCursor = makeReader([
      tokenResponse(),
      jsonResponse({ items: [inventoryItem()], next_cursor: "next" }),
      jsonResponse({ items: [], next_cursor: "next" }),
    ]);
    const repeatedCursorError = await repeatedCursor.reader
      .listActiveInstallations()
      .catch((error) => error);
    expect(repeatedCursorError).toBeInstanceOf(ControlPlaneError);
    expect(repeatedCursorError).toMatchObject({
      category: "invalid_response",
      upstreamStatus: 200,
      retryable: true,
    });
  });

  it("preserves inventory authorization failures as safe control-plane errors", async () => {
    const { reader } = makeReader([
      tokenResponse(),
      jsonResponse({ code: "access_denied", message: SECRET }, 403),
    ]);

    const thrown = await reader
      .listActiveInstallations()
      .catch((error) => error);

    expect(thrown).toBeInstanceOf(ControlPlaneError);
    expect(thrown).toMatchObject({
      category: "authorization",
      upstreamStatus: 403,
      httpStatus: 403,
      retryable: false,
      upstreamCode: "access_denied",
    });
    expect(thrown.message).not.toContain(SECRET);
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });
});
