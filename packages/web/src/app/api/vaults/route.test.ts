// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbCreateVault,
  mockAkbInstallReefVaultSkill,
  mockAkbListVaults,
  mockAkbReadConfig,
  mockAkbWriteConfig,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbCreateVault: vi.fn(),
  mockAkbInstallReefVaultSkill: vi.fn(),
  mockAkbListVaults: vi.fn(),
  mockAkbReadConfig: vi.fn(),
  mockAkbWriteConfig: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbCreateVault: mockAkbCreateVault,
    akbInstallReefVaultSkill: mockAkbInstallReefVaultSkill,
    akbListVaults: mockAkbListVaults,
    akbReadConfig: mockAkbReadConfig,
    akbWriteConfig: mockAkbWriteConfig,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import {
  AkbApiError,
  AuthError,
  type Config,
  type VaultSummary,
} from "@reef/core";
import { VALID_JWT, makeJwt } from "../__test-helpers__/jwt";
import { GET, POST } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

const SAMPLE_VAULTS: VaultSummary[] = [
  {
    name: "reef-acme",
    description: null,
    status: "active",
    role: "owner",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    name: "reef-zen",
    description: null,
    status: "active",
    role: "member",
    created_at: "2026-04-01T00:00:00.000Z",
  },
];

const GREENFIELD_CONFIG: Config = {
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

describe("GET /api/vaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/vaults");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT is expired", async () => {
    const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    const req = new Request("http://localhost/api/vaults", {
      headers: { cookie: `${SESSION_COOKIE}=${expiredJwt}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns enriched vaults with has_reef_config on happy path", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbReadConfig.mockImplementation(
      async ({ vault }: { vault: string }) =>
        vault === "reef-acme"
          ? {
              exists: true,
              config: { project_prefix: "ACME", monitored_repos: [] },
            }
          : {
              exists: false,
              config: { project_prefix: "REEF", monitored_repos: [] },
            },
    );
    const req = new Request("http://localhost/api/vaults", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.vaults).toHaveLength(2);
    expect(payload.vaults[0]).toMatchObject({
      name: "reef-acme",
      has_reef_config: true,
    });
    expect(payload.vaults[1]).toMatchObject({
      name: "reef-zen",
      has_reef_config: false,
    });
  });

  it("marks has_reef_config=false when readConfig rejects (one failing vault doesn't break the list)", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbReadConfig.mockImplementation(
      async ({ vault }: { vault: string }) => {
        if (vault === "reef-acme") {
          return {
            exists: true,
            config: { project_prefix: "ACME", monitored_repos: [] },
          };
        }
        throw new Error("network blip");
      },
    );
    const req = new Request("http://localhost/api/vaults", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.vaults[0].has_reef_config).toBe(true);
    expect(payload.vaults[1].has_reef_config).toBe(false);
  });

  it("translates AuthError to 401", async () => {
    mockAkbListVaults.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/vaults", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("translates AkbApiError to 502", async () => {
    mockAkbListVaults.mockRejectedValueOnce(
      new AkbApiError({ status: 500, message: "boom" }),
    );
    const req = new Request("http://localhost/api/vaults", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(502);
  });

  it("maps non-akb errors to a deterministic 500 (REEF-054 total translateError)", async () => {
    mockAkbListVaults.mockRejectedValueOnce(new Error("unrelated"));
    const req = new Request("http://localhost/api/vaults", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
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

  it("creates a new akb vault, writes reef config, and returns the config", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbCreateVault.mockResolvedValueOnce({
      vault_id: "v1",
      name: "reef-new",
      template: null,
      public_access: "none",
    });
    mockAkbWriteConfig.mockResolvedValueOnce(undefined);
    mockAkbInstallReefVaultSkill.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody({ description: "Fresh start" })),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "reef-new",
      config: GREENFIELD_CONFIG,
    });
    expect(mockAkbCreateVault).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "reef-new",
        description: "Fresh start",
      }),
    );
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-new",
        config: GREENFIELD_CONFIG,
        message: "Initialize reef workspace config",
      }),
    );
    expect(mockAkbInstallReefVaultSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-new",
      }),
    );
    expect(mockAkbCreateVault.mock.invocationCallOrder[0]).toBeLessThan(
      mockAkbInstallReefVaultSkill.mock.invocationCallOrder[0],
    );
    expect(
      mockAkbInstallReefVaultSkill.mock.invocationCallOrder[0],
    ).toBeLessThan(mockAkbWriteConfig.mock.invocationCallOrder[0]);
  });

  it("threads a provided authoring_language into the written config (REEF-160)", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbCreateVault.mockResolvedValueOnce({
      vault_id: "v1",
      name: "reef-new",
      template: null,
      public_access: "none",
    });
    mockAkbInstallReefVaultSkill.mockResolvedValueOnce(undefined);
    mockAkbWriteConfig.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody({ authoring_language: "ko" })),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "reef-new",
      config: { ...GREENFIELD_CONFIG, authoring_language: "ko" },
    });
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-new",
        config: expect.objectContaining({ authoring_language: "ko" }),
      }),
    );
  });

  it("defaults authoring_language to null when the field is omitted (REEF-160)", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbCreateVault.mockResolvedValueOnce({
      vault_id: "v1",
      name: "reef-new",
      template: null,
      public_access: "none",
    });
    mockAkbInstallReefVaultSkill.mockResolvedValueOnce(undefined);
    mockAkbWriteConfig.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody()),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ authoring_language: null }),
      }),
    );
  });

  it("returns 400 for an unknown authoring_language code (REEF-160)", async () => {
    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody({ authoring_language: "xx" })),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
    expect(mockAkbWriteConfig).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid vault names and prefixes", async () => {
    const badNameReq = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody({ name: "Bad_Name" })),
    });
    const badNameRes = await POST(badNameReq);
    expect(badNameRes.status).toBe(400);

    const badPrefixReq = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody({ project_prefix: "reef" })),
    });
    const badPrefixRes = await POST(badPrefixReq);
    expect(badPrefixRes.status).toBe(400);

    expect(mockAkbCreateVault).not.toHaveBeenCalled();
    expect(mockAkbWriteConfig).not.toHaveBeenCalled();
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      body: JSON.stringify(createVaultBody()),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns 409 when an accessible vault is already configured for reef", async () => {
    mockAkbListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-new", role: "owner" }],
    });
    mockAkbReadConfig.mockResolvedValueOnce({
      config: GREENFIELD_CONFIG,
      exists: true,
    });

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody()),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
    expect(mockAkbInstallReefVaultSkill).not.toHaveBeenCalled();
    expect(mockAkbWriteConfig).not.toHaveBeenCalled();
  });

  it("initializes reef config on an accessible raw vault instead of creating it again", async () => {
    mockAkbListVaults.mockResolvedValueOnce({
      vaults: [{ name: "reef-new", role: "owner" }],
    });
    mockAkbReadConfig.mockResolvedValueOnce({
      config: { project_prefix: "REEF", monitored_repos: [] },
      exists: false,
    });
    mockAkbInstallReefVaultSkill.mockResolvedValueOnce(undefined);
    mockAkbWriteConfig.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody()),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "reef-new",
      config: GREENFIELD_CONFIG,
    });
    expect(mockAkbCreateVault).not.toHaveBeenCalled();
    expect(mockAkbInstallReefVaultSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-new",
      }),
    );
    expect(mockAkbWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-new",
        config: GREENFIELD_CONFIG,
      }),
    );
  });

  it("does not write config when reef vault skill installation fails", async () => {
    mockAkbListVaults.mockResolvedValueOnce({ vaults: SAMPLE_VAULTS });
    mockAkbCreateVault.mockResolvedValueOnce({
      vault_id: "v1",
      name: "reef-new",
      template: null,
      public_access: "none",
    });
    mockAkbInstallReefVaultSkill.mockRejectedValueOnce(
      new Error("skill install failed"),
    );

    const req = new Request("http://localhost/api/vaults", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify(createVaultBody()),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "An unexpected error occurred.",
    });
    expect(mockAkbCreateVault).toHaveBeenCalled();
    expect(mockAkbInstallReefVaultSkill).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-new" }),
    );
    expect(mockAkbWriteConfig).not.toHaveBeenCalled();
  });
});
