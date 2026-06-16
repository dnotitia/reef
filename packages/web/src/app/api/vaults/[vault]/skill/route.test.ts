// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbGetVaultSkillStatus,
  mockAkbInstallReefVaultSkill,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbGetVaultSkillStatus: vi.fn(),
  mockAkbInstallReefVaultSkill: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbGetVaultSkillStatus: mockAkbGetVaultSkillStatus,
    akbInstallReefVaultSkill: mockAkbInstallReefVaultSkill,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AkbApiError, AuthError, type VaultSkillStatus } from "@reef/core";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET, POST } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function ctx(vault: string) {
  return { params: Promise.resolve({ vault }) };
}

const OUTDATED_STATUS: VaultSkillStatus = {
  installed_version: 0,
  current_version: 1,
  up_to_date: false,
  synced_at: null,
};

const CURRENT_STATUS: VaultSkillStatus = {
  installed_version: 1,
  current_version: 1,
  up_to_date: true,
  synced_at: "2026-06-09T00:00:00.000Z",
};

describe("GET /api/vaults/[vault]/skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 401 when the session cookie is missing", async () => {
    const res = await GET(
      new Request("http://localhost/api/vaults/reef-acme/skill"),
      ctx("reef-acme"),
    );
    expect(res.status).toBe(401);
    expect(mockAkbGetVaultSkillStatus).not.toHaveBeenCalled();
  });

  it("returns the skill status on the happy path", async () => {
    mockAkbGetVaultSkillStatus.mockResolvedValueOnce(OUTDATED_STATUS);
    const res = await GET(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        headers: authedHeaders(),
      }),
      ctx("reef-acme"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OUTDATED_STATUS);
  });

  it("returns 400 for an invalid vault name", async () => {
    const res = await GET(
      new Request("http://localhost/api/vaults/Bad%20Name/skill", {
        headers: authedHeaders(),
      }),
      ctx("Bad Name"),
    );
    expect(res.status).toBe(400);
    expect(mockAkbGetVaultSkillStatus).not.toHaveBeenCalled();
  });

  it("translates an AkbApiError to 502", async () => {
    mockAkbGetVaultSkillStatus.mockRejectedValueOnce(
      new AkbApiError({ status: 500, message: "boom" }),
    );
    const res = await GET(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        headers: authedHeaders(),
      }),
      ctx("reef-acme"),
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /api/vaults/[vault]/skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("re-applies the skill then returns the refreshed status", async () => {
    mockAkbGetVaultSkillStatus
      .mockResolvedValueOnce(OUTDATED_STATUS) // downgrade guard: older → proceed
      .mockResolvedValueOnce(CURRENT_STATUS); // post-install read
    mockAkbInstallReefVaultSkill.mockResolvedValueOnce(undefined);

    const res = await POST(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        method: "POST",
        headers: authedHeaders(),
      }),
      ctx("reef-acme"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CURRENT_STATUS);
    expect(mockAkbInstallReefVaultSkill).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme" }),
    );
    // Guard reads status before installing; the final status is read after.
    expect(mockAkbGetVaultSkillStatus).toHaveBeenCalledTimes(2);
    expect(
      mockAkbInstallReefVaultSkill.mock.invocationCallOrder[0],
    ).toBeLessThan(mockAkbGetVaultSkillStatus.mock.invocationCallOrder[1]);
  });

  it("no-ops without installing when the stored version is newer (downgrade guard)", async () => {
    const NEWER_STATUS: VaultSkillStatus = {
      installed_version: 99,
      current_version: 1,
      up_to_date: true,
      synced_at: "2026-12-31T00:00:00.000Z",
    };
    mockAkbGetVaultSkillStatus.mockResolvedValueOnce(NEWER_STATUS);

    const res = await POST(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        method: "POST",
        headers: authedHeaders(),
      }),
      ctx("reef-acme"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NEWER_STATUS);
    // Installing would replace the newer docs with this older release — should not run.
    expect(mockAkbInstallReefVaultSkill).not.toHaveBeenCalled();
    expect(mockAkbGetVaultSkillStatus).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when the session cookie is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        method: "POST",
      }),
      ctx("reef-acme"),
    );
    expect(res.status).toBe(401);
    expect(mockAkbInstallReefVaultSkill).not.toHaveBeenCalled();
  });

  it("surfaces a reader's upstream rejection as an auth failure and skips the post-install read", async () => {
    // The guard read succeeds (vault not newer), then the installer's write is
    // rejected for a reader. The adapter folds akb 401/403 into one AuthError,
    // so the route returns a 401-class response, not a distinct 403. The UI's
    // canWrite gate is what actually keeps readers off this path.
    mockAkbGetVaultSkillStatus.mockResolvedValueOnce(OUTDATED_STATUS);
    mockAkbInstallReefVaultSkill.mockRejectedValueOnce(
      new AuthError({ message: "Requires 'writer' role" }),
    );

    const res = await POST(
      new Request("http://localhost/api/vaults/reef-acme/skill", {
        method: "POST",
        headers: authedHeaders(),
      }),
      ctx("reef-acme"),
    );

    expect(res.status).toBe(401);
    // Guard read happened; the post-install read did not (install threw).
    expect(mockAkbGetVaultSkillStatus).toHaveBeenCalledTimes(1);
  });
});
