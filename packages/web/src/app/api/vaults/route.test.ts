// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbCreateVault,
  mockAkbListVaults,
  mockAkbReadConfig,
  mockAkbReadMemberInstallationActive,
  mockCreateAkbAdapter,
  mockReadInstallationTarget,
} = vi.hoisted(() => ({
  mockAkbCreateVault: vi.fn(),
  mockAkbListVaults: vi.fn(),
  mockAkbReadConfig: vi.fn(),
  mockAkbReadMemberInstallationActive: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
  mockReadInstallationTarget: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbCreateVault: mockAkbCreateVault,
    akbListVaults: mockAkbListVaults,
    akbReadConfig: mockAkbReadConfig,
    akbReadMemberInstallationActive: mockAkbReadMemberInstallationActive,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

vi.mock("@/server/adapters/installationTarget", () => ({
  readInstallationTarget: mockReadInstallationTarget,
}));

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import {
  AkbApiError,
  AuthError,
  type Config,
  DEFAULT_CONFIG,
  type VaultSummary,
} from "@reef/core";
import { VALID_JWT, makeJwt } from "../__test-helpers__/jwt";
import { GET, POST } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

const SAMPLE_VAULTS: VaultSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "reef-acme",
    description: null,
    status: "active",
    role: "owner",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "reef-zen",
    description: null,
    status: "active",
    role: "member",
    created_at: "2026-04-01T00:00:00.000Z",
  },
];

const GREENFIELD_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  project_prefix: "REEF",
  monitored_repos: [{ github_id: 123456, owner: "octo", name: "cat" }],
  authoring_language: null,
};

function createVaultBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "reef-new",
    project_prefix: GREENFIELD_CONFIG.project_prefix,
    monitored_repos: GREENFIELD_CONFIG.monitored_repos,
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authedHeaders())) {
    headers.set(key, value);
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("GET /api/vaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockReadInstallationTarget.mockReturnValue({
      appId: "33333333-3333-4333-8333-333333333333",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns member-scoped active states for accessible vaults", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbReadMemberInstallationActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await GET(request("/api/vaults"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vaults: [
        { name: "reef-acme", installation_active: true },
        { name: "reef-zen", installation_active: false },
      ],
    });
    expect(mockAkbReadMemberInstallationActive).toHaveBeenNthCalledWith(1, {
      adapter: expect.any(Object),
      appId: "33333333-3333-4333-8333-333333333333",
      vaultId: SAMPLE_VAULTS[0]?.id,
    });
    expect(mockAkbReadMemberInstallationActive).toHaveBeenCalledTimes(2);
    expect(mockAkbReadConfig).not.toHaveBeenCalled();
  });

  it("keeps confirmed active vaults and marks a failed active lookup unknown", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbReadMemberInstallationActive
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("network blip"));

    const response = await GET(request("/api/vaults"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vaults: [{ installation_active: true }, { installation_active: null }],
    });
  });

  it("returns unknown without active lookups when the deployment target is absent", async () => {
    mockReadInstallationTarget.mockReturnValueOnce(null);
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });

    const response = await GET(request("/api/vaults"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vaults: [{ installation_active: null }, { installation_active: null }],
    });
    expect(mockAkbReadMemberInstallationActive).not.toHaveBeenCalled();
  });

  it("preserves the account session-denial behavior from a member-active lookup", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbReadMemberInstallationActive
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new AuthError({ origin: "akb", status: 401 }));

    const response = await GET(request("/api/vaults"));

    expect(response.status).toBe(401);
    expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("__reef_session=");
  });

  it("returns 401 when the session cookie is missing or expired", async () => {
    expect((await GET(new Request("http://localhost/api/vaults"))).status).toBe(
      401,
    );

    const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    const expired = new Request("http://localhost/api/vaults", {
      headers: { cookie: `${SESSION_COOKIE}=${expiredJwt}` },
    });
    expect((await GET(expired)).status).toBe(401);
  });

  it("translates AKB and unexpected errors", async () => {
    mockAkbListVaults.mockRejectedValueOnce(new AuthError({}));
    expect((await GET(request("/api/vaults"))).status).toBe(401);

    mockAkbListVaults.mockRejectedValueOnce(
      new AkbApiError({ status: 500, message: "boom" }),
    );
    expect((await GET(request("/api/vaults"))).status).toBe(502);

    mockAkbListVaults.mockRejectedValueOnce(new Error("unrelated"));
    const unexpected = await GET(request("/api/vaults"));
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({
      error: "An unexpected error occurred.",
    });
  });
});

describe("POST /api/vaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates only an AKB vault and returns the pending workspace setup", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbCreateVault.mockResolvedValueOnce({
      vault_id: "33333333-3333-4333-8333-333333333333",
      name: "reef-new",
      template: null,
      public_access: "none",
    });

    const response = await POST(
      request("/api/vaults", {
        method: "POST",
        body: JSON.stringify(createVaultBody({ description: "Fresh start" })),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      vault_id: "33333333-3333-4333-8333-333333333333",
      name: "reef-new",
      config: GREENFIELD_CONFIG,
    });
    expect(mockAkbCreateVault).toHaveBeenCalledWith(
      expect.objectContaining({ name: "reef-new", description: "Fresh start" }),
    );
    expect(mockAkbReadConfig).not.toHaveBeenCalled();
  });

  it("uses an accessible raw vault without initializing or mutating it", async () => {
    const rawVault = { ...SAMPLE_VAULTS[0], name: "reef-new" };
    mockAkbListVaults.mockResolvedValueOnce({ vaults: [rawVault] });
    mockAkbReadConfig.mockResolvedValueOnce({
      config: DEFAULT_CONFIG,
      exists: false,
    });

    const response = await POST(
      request("/api/vaults", {
        method: "POST",
        body: JSON.stringify(createVaultBody()),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vault_id: rawVault.id,
      name: "reef-new",
    });
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
  });

  it("rejects an already configured workspace", async () => {
    mockAkbListVaults.mockResolvedValueOnce({
      vaults: [{ ...SAMPLE_VAULTS[0], name: "reef-new" }],
    });
    mockAkbReadConfig.mockResolvedValueOnce({
      config: GREENFIELD_CONFIG,
      exists: true,
    });

    const response = await POST(
      request("/api/vaults", {
        method: "POST",
        body: JSON.stringify(createVaultBody()),
      }),
    );

    expect(response.status).toBe(409);
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
  });

  it("rejects invalid data and unauthenticated requests", async () => {
    const invalid = await POST(
      request("/api/vaults", {
        method: "POST",
        body: JSON.stringify(createVaultBody({ project_prefix: "reef" })),
      }),
    );
    expect(invalid.status).toBe(400);

    const unauthenticated = await POST(
      new Request("http://localhost/api/vaults", {
        method: "POST",
        body: JSON.stringify(createVaultBody()),
      }),
    );
    expect(unauthenticated.status).toBe(401);
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
  });
});
