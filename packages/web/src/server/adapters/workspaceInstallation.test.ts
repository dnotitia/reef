import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAkbHasReefVaultSkillDocuments,
  mockAkbInitializeReefWorkspace,
  mockAkbListTemplates,
  mockAkbReadConfig,
  mockAkbReadInstallation,
  mockAkbReadMemberInstallationActive,
  mockReadInstallationTarget,
} = vi.hoisted(() => ({
  mockAkbHasReefVaultSkillDocuments: vi.fn(),
  mockAkbInitializeReefWorkspace: vi.fn(),
  mockAkbListTemplates: vi.fn(),
  mockAkbReadConfig: vi.fn(),
  mockAkbReadInstallation: vi.fn(),
  mockAkbReadMemberInstallationActive: vi.fn(),
  mockReadInstallationTarget: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbHasReefVaultSkillDocuments: mockAkbHasReefVaultSkillDocuments,
    akbInitializeReefWorkspace: mockAkbInitializeReefWorkspace,
    akbListTemplates: mockAkbListTemplates,
    akbReadConfig: mockAkbReadConfig,
    akbReadInstallation: mockAkbReadInstallation,
    akbReadMemberInstallationActive: mockAkbReadMemberInstallationActive,
  };
});

vi.mock("./installationTarget", () => ({
  readInstallationTarget: mockReadInstallationTarget,
}));

import { AuthError } from "@reef/core";
import { DEFAULT_ISSUE_TEMPLATES } from "../../features/settings/lib/defaultIssueTemplates";
import { readWorkspaceInstallationState } from "./workspaceInstallation";

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

function completeTemplates() {
  return DEFAULT_ISSUE_TEMPLATES.map((template) => ({ template }));
}

describe("readWorkspaceInstallationState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadInstallationTarget.mockReturnValue(target);
    mockAkbReadConfig.mockResolvedValue({
      exists: true,
      config: { project_prefix: "ACME", monitored_repos: [] },
    });
    mockAkbListTemplates.mockResolvedValue(completeTemplates());
    mockAkbHasReefVaultSkillDocuments.mockResolvedValue(true);
    mockAkbInitializeReefWorkspace.mockResolvedValue(undefined);
  });

  it("lets an active reader reach Ready after read-only Reef initialization checks", async () => {
    mockAkbReadMemberInstallationActive.mockResolvedValueOnce(true);

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "ready" });
    expect(mockAkbReadMemberInstallationActive).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      appId: target.appId,
      vaultId: vault.id,
    });
    expect(mockAkbReadInstallation).not.toHaveBeenCalled();
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("does not classify an inactive member installation as not installed", async () => {
    mockAkbReadMemberInstallationActive.mockResolvedValueOnce(false);

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbReadInstallation).not.toHaveBeenCalled();
    expect(mockAkbReadConfig).not.toHaveBeenCalled();
  });

  it("does not report Ready when AKB is active but Reef initialization is incomplete", async () => {
    mockAkbReadMemberInstallationActive.mockResolvedValueOnce(true);
    mockAkbReadConfig.mockResolvedValueOnce({
      exists: false,
      config: { project_prefix: "REEF", monitored_repos: [] },
    });

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("does not treat missing managed skill documents as initialized", async () => {
    mockAkbReadMemberInstallationActive.mockResolvedValueOnce(true);
    mockAkbHasReefVaultSkillDocuments.mockResolvedValueOnce(false);

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault,
    });

    expect(state).toEqual({ installation_status: "management_required" });
    expect(mockAkbHasReefVaultSkillDocuments).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: vault.name,
    });
  });

  it("preserves the member endpoint's resource denial instead of treating it as inactive", async () => {
    mockAkbReadMemberInstallationActive.mockRejectedValueOnce(
      new AuthError({ origin: "akb", status: 403 }),
    );

    await expect(
      readWorkspaceInstallationState({
        adapter: { request: vi.fn() } as never,
        vault,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps a complete owner workspace ready without reinitializing it", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
    };
    mockAkbReadInstallation.mockResolvedValueOnce(installation);

    const state = await readWorkspaceInstallationState({
      adapter: { request: vi.fn() } as never,
      vault: { ...vault, role: "owner" },
    });

    expect(state).toEqual({ installation_status: "ready", installation });
    expect(mockAkbReadInstallation).toHaveBeenCalledTimes(1);
    expect(mockAkbReadMemberInstallationActive).not.toHaveBeenCalled();
    expect(mockAkbInitializeReefWorkspace).not.toHaveBeenCalled();
  });

  it("initializes an incomplete active owner workspace and verifies readiness", async () => {
    const installation = {
      installationId: "44444444-4444-4444-8444-444444444444",
      appId: target.appId,
      vaultId: vault.id,
      lifecycle: "active",
    };
    mockAkbReadInstallation.mockResolvedValueOnce(installation);
    mockAkbReadConfig
      .mockResolvedValueOnce({
        exists: false,
        config: { project_prefix: "REEF", monitored_repos: [] },
      })
      .mockResolvedValueOnce({
        exists: true,
        config: { project_prefix: "REEF", monitored_repos: [] },
      });
    mockAkbListTemplates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(completeTemplates());
    mockAkbHasReefVaultSkillDocuments
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

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
    expect(mockAkbReadConfig).toHaveBeenCalledTimes(2);
    expect(mockAkbListTemplates).toHaveBeenCalledTimes(2);
    expect(mockAkbHasReefVaultSkillDocuments).toHaveBeenCalledTimes(2);
  });
});
