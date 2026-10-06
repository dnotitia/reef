import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAkbCheckWorkspaceReadiness,
  mockAkbInitializeReefWorkspace,
  mockAkbListVaults,
  mockReadInstallationTarget,
} = vi.hoisted(() => ({
  mockAkbCheckWorkspaceReadiness: vi.fn(),
  mockAkbInitializeReefWorkspace: vi.fn(),
  mockAkbListVaults: vi.fn(),
  mockReadInstallationTarget: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbCheckWorkspaceReadiness: mockAkbCheckWorkspaceReadiness,
    akbInitializeReefWorkspace: mockAkbInitializeReefWorkspace,
    akbListVaults: mockAkbListVaults,
  };
});

vi.mock("./installationTarget", () => ({
  readInstallationTarget: mockReadInstallationTarget,
}));

import {
  AuthError,
  ControlPlaneError,
  SchemaValidationError,
  WorkspaceReadinessError,
} from "@reef/core";
import { DEFAULT_ISSUE_TEMPLATES } from "../../features/settings/lib/defaultIssueTemplates";
import {
  readWorkspaceInstallationState,
  readWorkspaceInstallationStatus,
  requireWorkspaceReady,
} from "./workspaceInstallation";

const target = {
  appId: "11111111-1111-4111-8111-111111111111",
  releaseId: "22222222-2222-4222-8222-222222222222",
  appKey: "reef" as const,
  version: "0.16.1",
  sourceRevision: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  manifestChecksum: "c".repeat(64),
};

const vault = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "reef-acme",
  role: "reader",
};

const active = {
  state: "active",
  initialization_complete: true,
} as const;

describe("readWorkspaceInstallationState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadInstallationTarget.mockReturnValue(target);
    mockAkbInitializeReefWorkspace.mockResolvedValue(undefined);
    mockAkbListVaults.mockResolvedValue({
      vaults: [{ ...vault, role: "owner" }],
    });
  });

  it("uses Core readiness for a member and reports Ready only after all checks pass", async () => {
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce(active);
    const adapter = { request: vi.fn() } as never;

    const state = await readWorkspaceInstallationState({ adapter, vault });

    expect(state).toEqual({ installation_status: "ready" });
    expect(mockAkbCheckWorkspaceReadiness).toHaveBeenCalledWith({
      adapter,
      appId: target.appId,
      vaultId: vault.id,
      vault: vault.name,
      canManage: false,
      requiredTemplateNames: DEFAULT_ISSUE_TEMPLATES.map(({ name }) => name),
    });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("never returns management details to members, even if a readiness result contains them", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
      desiredRelease: { version: "secret-release" },
    };
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      ...active,
      installation,
    });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "ready" });
    expect(JSON.stringify(state)).not.toContain("secret-release");
  });

  it("keeps an inactive canonical member installation behind the management gate", async () => {
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({ state: "inactive" });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("reduces every non-ready member lifecycle to management_required", async () => {
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      state: "blocked",
      installation: {
        lifecycle: "blocked",
        blockedReason: "worker_timeout",
        desiredRelease: { version: "private-version" },
      },
    });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(JSON.stringify(state)).not.toContain("worker_timeout");
    expect(JSON.stringify(state)).not.toContain("private-version");
  });

  it("does not initialize product data for a member with incomplete setup", async () => {
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      state: "active",
      initialization_complete: false,
    });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("preserves authentication and resource-denial errors from Core", async () => {
    mockAkbCheckWorkspaceReadiness.mockRejectedValueOnce(
      new AuthError({ origin: "akb", status: 403 }),
    );

    await expect(
      readWorkspaceInstallationState({
        adapter: { request: vi.fn() } as never,
        vault,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps an initialized owner workspace ready without writing product data", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
    };
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      ...active,
      installation,
    });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, role: "owner" },
    });

    expect(state).toEqual({ installation_status: "ready", installation });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("initializes an incomplete active owner workspace only after Core verifies readiness", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
    };
    mockAkbCheckWorkspaceReadiness
      .mockResolvedValueOnce({
        state: "active",
        initialization_complete: false,
        installation,
      })
      .mockResolvedValueOnce({
        state: "active",
        initialization_complete: true,
        installation,
      });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, role: "owner" },
    });

    expect(state).toEqual({ installation_status: "ready", installation });
    expect(mockAkbInitializeReefWorkspace).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: vault.name,
      defaultTemplates: DEFAULT_ISSUE_TEMPLATES,
    });
    expect(mockAkbCheckWorkspaceReadiness).toHaveBeenCalledTimes(2);
  });

  it("returns unknown to managers when the selected vault has no canonical id", async () => {
    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, id: "", role: "owner" },
    });

    expect(state).toEqual({ installation_status: "unknown" });
    expect(mockAkbCheckWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it("does not reveal a missing canonical id to members", async () => {
    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, id: "" },
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbCheckWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: "not_installed" }, "installation_required", 409],
    [
      { state: "uninstalled", installation: { lifecycle: "uninstalled" } },
      "installation_required",
      409,
    ],
    [
      { state: "installing", installation: { lifecycle: "installing" } },
      "installation_required",
      409,
    ],
    [
      { state: "upgrading", installation: { lifecycle: "upgrading" } },
      "upgrade_required",
      409,
    ],
    [
      {
        state: "blocked",
        installation: { lifecycle: "blocked", blockedReason: "worker_timeout" },
      },
      "installation_blocked",
      409,
    ],
    [{ state: "adoption_required" }, "adoption_required", 409],
    [{ state: "inactive" }, "management_required", 403],
  ] as const)(
    "maps canonical state %s to machine code %s / %s",
    async (check, code, status) => {
      mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce(check);

      await expect(
        requireWorkspaceReady({
          adapter: { request: vi.fn() } as never,
          vaultName: vault.name,
        }),
      ).rejects.toMatchObject({
        machineCode: code,
        status,
      });
    },
  );

  it.each([
    new ControlPlaneError({
      category: "unavailable",
      operation: "installation.get",
      upstreamStatus: 503,
      httpStatus: 503,
      retryable: true,
    }),
    new SchemaValidationError({ issues: ["private upstream detail"] }),
  ])(
    "maps installation lookup failures to the unavailable readiness code",
    async (error) => {
      mockAkbCheckWorkspaceReadiness.mockRejectedValueOnce(error);

      await expect(
        requireWorkspaceReady({
          adapter: { request: vi.fn() } as never,
          vaultName: vault.name,
        }),
      ).rejects.toMatchObject({
        machineCode: "installation_status_unavailable",
        status: 503,
      });
    },
  );
});

describe("readWorkspaceInstallationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadInstallationTarget.mockReturnValue(target);
  });

  it("reports an incomplete owner workspace without initializing it", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
    };
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      state: "active",
      initialization_complete: false,
      installation,
    });

    const status = await readWorkspaceInstallationStatus({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, role: "owner" },
    });

    expect(status).toEqual({
      installation_status: "management_required",
      installation,
    });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("keeps a member's ready status without returning installation details", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
      desiredRelease: { version: "private-version" },
    };
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      ...active,
      installation,
    });

    const status = await readWorkspaceInstallationStatus({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(status).toEqual({ installation_status: "ready" });
    expect(JSON.stringify(status)).not.toContain("private-version");
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("does not expose non-ready installation details to a member", async () => {
    mockAkbCheckWorkspaceReadiness.mockResolvedValueOnce({
      state: "blocked",
      installation: {
        lifecycle: "blocked",
        blockedReason: "worker_timeout",
      },
    });

    const status = await readWorkspaceInstallationStatus({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(status).toEqual({ installation_status: "management_required" });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("propagates ACL and readiness read errors", async () => {
    const denial = new AuthError({ origin: "akb", status: 403 });
    mockAkbCheckWorkspaceReadiness.mockRejectedValueOnce(denial);

    await expect(
      readWorkspaceInstallationStatus({
        adapter: { request: vi.fn() } as never,
        vault,
      }),
    ).rejects.toBe(denial);
  });

  it("maps unavailable readiness reads instead of returning an empty status", async () => {
    mockAkbCheckWorkspaceReadiness.mockRejectedValueOnce(
      new ControlPlaneError({
        category: "unavailable",
        operation: "installation.get",
        upstreamStatus: 503,
        httpStatus: 503,
        retryable: true,
      }),
    );

    const status = readWorkspaceInstallationStatus({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    await expect(status).rejects.toBeInstanceOf(WorkspaceReadinessError);
    await expect(status).rejects.toMatchObject({
      machineCode: "installation_status_unavailable",
      status: 503,
    });
  });
});
