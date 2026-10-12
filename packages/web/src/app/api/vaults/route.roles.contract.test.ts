// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../__test-helpers__/jwt";

vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/server/adapters/installationTarget", () => ({
  readInstallationTarget: () => ({
    appId: "33333333-3333-4333-8333-333333333333",
  }),
}));

import { GET } from "./route";

const appId = "33333333-3333-4333-8333-333333333333";
const vaultId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const baseUrl = "http://akb.contract.test";
const installationPath = `${baseUrl}/api/v1/apps/${appId}/installations/${vaultId}`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv("REEF_AUTH_MODE", "local");
  vi.stubEnv("AKB_BACKEND_URL", baseUrl);
  server.use(
    http.get(`${baseUrl}/api/v1/auth/me`, () =>
      HttpResponse.json({ username: "alice", is_admin: false }),
    ),
  );
});

function request() {
  return new Request("http://localhost/api/vaults", {
    headers: { cookie: `${SESSION_COOKIE}=${VALID_JWT}` },
  });
}

function installation(lifecycle = "active") {
  return {
    installation_id: "44444444-4444-4444-8444-444444444444",
    app_id: appId,
    vault_id: vaultId,
    lifecycle,
    desired_release: { id: releaseId, version: "0.17.1" },
    current_release: { id: releaseId, version: "0.17.1" },
  };
}

function vaultList(role: string) {
  server.use(
    http.get(`${baseUrl}/api/v1/my/vaults`, () =>
      HttpResponse.json({
        vaults: [{ id: vaultId, name: "reef-test", role, status: "active" }],
      }),
    ),
  );
}

describe("GET /api/vaults AKB role contract", () => {
  it("uses one inventory request for a verified system admin", async () => {
    vaultList("admin");
    let inventoryReads = 0;
    server.use(
      http.get(`${baseUrl}/api/v1/auth/me`, () =>
        HttpResponse.json({ username: "admin", is_admin: true }),
      ),
      http.get(`${baseUrl}/api/v1/apps/${appId}/inventory`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("lifecycle")).toBe(
          "active",
        );
        inventoryReads += 1;
        return HttpResponse.json({
          items: [{ ...installation(), vault_name: "reef-test" }],
          next_cursor: null,
        });
      }),
      http.get(installationPath, () => {
        throw new Error("admin inventory must replace detail fan-out");
      }),
    );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vaults: [{ installation_active: true }],
    });
    expect(inventoryReads).toBe(1);
  });

  it.each(["owner", "admin"])(
    "keeps a %s workspace available when AKB rejects the member-only API",
    async (role) => {
      vaultList(role);
      let memberReads = 0;
      let managementReads = 0;
      server.use(
        http.get(`${installationPath}/active`, () => {
          memberReads += 1;
          return HttpResponse.json(
            {
              detail: {
                code: "permission_denied",
                message: "Installation request denied",
              },
            },
            { status: 403 },
          );
        }),
        http.get(installationPath, () => {
          managementReads += 1;
          return HttpResponse.json(installation());
        }),
      );
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        vaults: [{ name: "reef-test", installation_active: true }],
      });
      expect({ memberReads, managementReads }).toEqual({
        memberReads: 0,
        managementReads: 1,
      });
    },
  );

  it.each(["reader", "writer"])(
    "uses only minimal availability for a %s",
    async (role) => {
      vaultList(role);
      let managementReads = 0;
      server.use(
        http.get(`${installationPath}/active`, () =>
          HttpResponse.json({ active: true }),
        ),
        http.get(installationPath, () => {
          managementReads += 1;
          return new HttpResponse(null, { status: 403 });
        }),
      );
      const response = await GET(request());
      expect(await response.json()).toMatchObject({
        vaults: [{ installation_active: true }],
      });
      expect(managementReads).toBe(0);
    },
  );

  it.each([false, true])(
    "keeps a management denial unknown without a fallback or sign-out (system admin: %s)",
    async (isAdmin) => {
      vaultList("owner");
      let memberReads = 0;
      server.use(
        http.get(`${baseUrl}/api/v1/auth/me`, () =>
          HttpResponse.json({ username: "alice", is_admin: isAdmin }),
        ),
        http.get(`${baseUrl}/api/v1/apps/${appId}/inventory`, () =>
          HttpResponse.json(
            { detail: { code: "permission_denied" } },
            { status: 403 },
          ),
        ),
        http.get(installationPath, () =>
          HttpResponse.json(
            { detail: { code: "permission_denied" } },
            { status: 403 },
          ),
        ),
        http.get(`${installationPath}/active`, () => {
          memberReads += 1;
          return HttpResponse.json({ active: true });
        }),
      );
      const response = await GET(request());
      expect(await response.json()).toMatchObject({
        vaults: [{ installation_active: null }],
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(memberReads).toBe(0);
    },
  );

  it("reports a missing management installation as inactive", async () => {
    vaultList("owner");
    server.use(
      http.get(installationPath, () => new HttpResponse(null, { status: 404 })),
    );
    const response = await GET(request());
    expect(await response.json()).toMatchObject({
      vaults: [{ installation_active: false }],
    });
  });
});
