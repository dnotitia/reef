import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasReefVaultSkillDocuments,
  listTemplates,
  readConfig,
  readInstallation,
  readMemberInstallationActive,
  verifyRequiredTables,
} = vi.hoisted(() => ({
  hasReefVaultSkillDocuments: vi.fn(),
  listTemplates: vi.fn(),
  readConfig: vi.fn(),
  readInstallation: vi.fn(),
  readMemberInstallationActive: vi.fn(),
  verifyRequiredTables: vi.fn(),
}));

vi.mock("../controlPlane/installationLifecycle", () => ({
  readInstallation,
  readMemberInstallationActive,
}));
vi.mock("../core/verifyRequiredTables", () => ({ verifyRequiredTables }));
vi.mock("../vaultSkill/vaultSkill", () => ({ hasReefVaultSkillDocuments }));
vi.mock("./config", () => ({ readConfig }));
vi.mock("./templates", () => ({ listTemplates }));

import { NotFoundError } from "../../../errors";
import { checkWorkspaceReadiness } from "./readiness";

const appId = "11111111-1111-4111-8111-111111111111";
const vaultId = "22222222-2222-4222-8222-222222222222";
const installation = {
  installationId: "33333333-3333-4333-8333-333333333333",
  appId,
  vaultId,
  lifecycle: "active",
};
const params = {
  adapter: { request: vi.fn() },
  appId,
  vaultId,
  vault: "reef-sample",
  requiredTemplateNames: ["bug", "task"],
};

describe("checkWorkspaceReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMemberInstallationActive.mockResolvedValue(true);
    readInstallation.mockResolvedValue(installation);
    verifyRequiredTables.mockResolvedValue(undefined);
    readConfig.mockResolvedValue({ exists: true, config: {} });
    listTemplates.mockResolvedValue([
      { template: { name: "bug" } },
      { template: { name: "task" } },
    ]);
    hasReefVaultSkillDocuments.mockResolvedValue(true);
  });

  it("short-circuits inactive members before table or product-data reads", async () => {
    readMemberInstallationActive.mockResolvedValueOnce(false);

    await expect(
      checkWorkspaceReadiness({ ...params, canManage: false }),
    ).resolves.toEqual({ state: "inactive" });

    expect(verifyRequiredTables).not.toHaveBeenCalled();
    expect(readConfig).not.toHaveBeenCalled();
    expect(listTemplates).not.toHaveBeenCalled();
    expect(hasReefVaultSkillDocuments).not.toHaveBeenCalled();
    expect(readInstallation).not.toHaveBeenCalled();
  });

  it("combines active member, verified schema, and initialized product data", async () => {
    await expect(
      checkWorkspaceReadiness({ ...params, canManage: false }),
    ).resolves.toEqual({
      state: "active",
      initialization_complete: true,
    });

    expect(verifyRequiredTables).toHaveBeenCalledWith({
      adapter: params.adapter,
      vault: params.vault,
      canManage: false,
    });
    expect(readInstallation).not.toHaveBeenCalled();
  });

  it("does not check or initialize Reef product data when required tables fail", async () => {
    const failure = new Error("schema mismatch");
    verifyRequiredTables.mockRejectedValueOnce(failure);

    await expect(
      checkWorkspaceReadiness({ ...params, canManage: false }),
    ).rejects.toBe(failure);

    expect(readConfig).not.toHaveBeenCalled();
    expect(listTemplates).not.toHaveBeenCalled();
    expect(hasReefVaultSkillDocuments).not.toHaveBeenCalled();
  });

  it("returns canonical manager lifecycle details without reading tables when inactive", async () => {
    readInstallation.mockResolvedValueOnce({
      ...installation,
      lifecycle: "uninstalled",
    });

    await expect(
      checkWorkspaceReadiness({ ...params, canManage: true }),
    ).resolves.toEqual({
      state: "uninstalled",
      installation: { ...installation, lifecycle: "uninstalled" },
    });

    expect(verifyRequiredTables).not.toHaveBeenCalled();
  });

  it("classifies an absent canonical installation from config adoption state", async () => {
    readInstallation.mockRejectedValueOnce(new NotFoundError());
    readConfig.mockResolvedValueOnce({ exists: true, config: {} });

    await expect(
      checkWorkspaceReadiness({ ...params, canManage: true }),
    ).resolves.toEqual({ state: "adoption_required" });

    expect(verifyRequiredTables).not.toHaveBeenCalled();
  });

  it("reports incomplete owner product data only after canonical schema verification", async () => {
    readConfig.mockResolvedValueOnce({ exists: false, config: {} });

    await expect(
      checkWorkspaceReadiness({ ...params, canManage: true }),
    ).resolves.toEqual({
      state: "active",
      installation,
      initialization_complete: false,
    });

    expect(verifyRequiredTables).toHaveBeenCalledTimes(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
  });
});
