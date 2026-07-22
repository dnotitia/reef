// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaLifecycleError } from "../../../errors";
import type { WorkspaceInitializationState } from "../../../schemas/workspace/initialization";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  verify: vi.fn(),
  skillStatus: vi.fn(),
  installSkillDocuments: vi.fn(),
  stampSkill: vi.fn(),
  readConfig: vi.fn(),
  writeInitialConfig: vi.fn(),
  advanceMarker: vi.fn(),
  createMarker: vi.fn(),
  readMarker: vi.fn(),
  createVault: vi.fn(),
  grantMember: vi.fn(),
  listMembers: vi.fn(),
  listVaults: vi.fn(),
}));

vi.mock("../core/tables", () => ({
  reconcileWorkspaceSchema: mocks.reconcile,
  verifyWorkspaceSchema: mocks.verify,
}));
vi.mock("../vaultSkill/vaultSkill", () => ({
  getVaultSkillStatus: mocks.skillStatus,
  installReefVaultSkillDocuments: mocks.installSkillDocuments,
  stampReefVaultSkillVersion: mocks.stampSkill,
}));
vi.mock("./config", () => ({
  readConfig: mocks.readConfig,
  writeInitialConfig: mocks.writeInitialConfig,
}));
vi.mock("./initializationMarker", () => ({
  advanceWorkspaceInitializationMarker: mocks.advanceMarker,
  createWorkspaceInitializationMarker: mocks.createMarker,
  readWorkspaceInitializationMarker: mocks.readMarker,
}));
vi.mock("./vaults", () => ({
  createVault: mocks.createVault,
  grantVaultMember: mocks.grantMember,
  listVaultMembers: mocks.listMembers,
  listVaults: mocks.listVaults,
}));

import {
  initializeWorkspace,
  workspaceInitializationFingerprint,
} from "./initialization";

const config = {
  project_prefix: "REEF",
  monitored_repos: [],
  authoring_language: null,
  stale_hide_completed_days: 28,
  stale_hide_canceled_days: 7,
  ai_scanning_enabled: false,
};

function stored(state: WorkspaceInitializationState, fingerprint: string) {
  return {
    uri: "akb://reef-sample/coll/overview/doc/reef-initialization.md",
    path: "overview/reef-initialization.md",
    currentCommit: `commit-${state}`,
    marker: {
      schema_version: 1,
      state,
      request_fingerprint: fingerprint,
    },
  };
}

describe("initializeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listVaults.mockResolvedValue({ vaults: [{ name: "reef-sample" }] });
    mocks.listMembers.mockResolvedValue({
      members: [{ username: "reef-schema", role: "writer" }],
    });
    mocks.readConfig.mockResolvedValue({ exists: true, config });
    mocks.verify.mockResolvedValue({
      schemaVersion: 1,
      manifestVerified: true,
    });
    mocks.skillStatus.mockResolvedValue({ up_to_date: true });
    mocks.advanceMarker.mockImplementation(
      async (_adapter, _vault, current, nextState) =>
        stored(nextState, current.marker.request_fingerprint),
    );
  });

  it("converges a same-fingerprint ready retry without mutation", async () => {
    const fingerprint = await workspaceInitializationFingerprint(
      "reef-sample",
      config,
    );
    mocks.readMarker.mockResolvedValue(stored("ready", fingerprint));

    await expect(
      initializeWorkspace({
        adapter: { request: vi.fn() },
        request: { name: "reef-sample", config },
        serviceUsername: "reef-schema",
      }),
    ).resolves.toMatchObject({
      name: "reef-sample",
      state: "ready",
      marker_uri: "akb://reef-sample/coll/overview/doc/reef-initialization.md",
    });
    expect(mocks.grantMember).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.installSkillDocuments).not.toHaveBeenCalled();
    expect(mocks.writeInitialConfig).not.toHaveBeenCalled();
  });

  it("returns durable current config on an original-request retry after routine edits", async () => {
    const fingerprint = await workspaceInitializationFingerprint(
      "reef-sample",
      config,
    );
    const editedConfig = { ...config, project_prefix: "EDITED" };
    mocks.readMarker.mockResolvedValue(stored("ready", fingerprint));
    mocks.readConfig.mockResolvedValue({ exists: true, config: editedConfig });

    await expect(
      initializeWorkspace({
        adapter: { request: vi.fn() },
        request: { name: "reef-sample", config },
        serviceUsername: "reef-schema",
      }),
    ).resolves.toMatchObject({ config: editedConfig, state: "ready" });
    expect(mocks.writeInitialConfig).not.toHaveBeenCalled();
  });

  it("rejects a different-fingerprint retry before lifecycle mutation", async () => {
    mocks.readMarker.mockResolvedValue(stored("initializing", "b".repeat(64)));

    await expect(
      initializeWorkspace({
        adapter: { request: vi.fn() },
        request: { name: "reef-sample", config },
        serviceUsername: "reef-schema",
      }),
    ).rejects.toMatchObject({
      context: { reason: "initialization_conflict", vault: "reef-sample" },
    });
    expect(mocks.grantMember).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.advanceMarker).not.toHaveBeenCalled();
  });

  it.each([
    ["writer_registered", 1, 1, 1],
    ["schema_provisioned", 0, 1, 1],
    ["skill_installed", 0, 0, 1],
  ] as const)(
    "resumes durably from %s without replaying completed stages",
    async (state, reconcileCount, skillCount, configCount) => {
      const fingerprint = await workspaceInitializationFingerprint(
        "reef-sample",
        config,
      );
      mocks.readMarker.mockResolvedValue(stored(state, fingerprint));

      await expect(
        initializeWorkspace({
          adapter: { request: vi.fn() },
          request: { name: "reef-sample", config },
          serviceUsername: "reef-schema",
        }),
      ).resolves.toMatchObject({ state: "ready" });
      expect(mocks.reconcile).toHaveBeenCalledTimes(reconcileCount);
      expect(mocks.installSkillDocuments).toHaveBeenCalledTimes(skillCount);
      expect(mocks.writeInitialConfig).toHaveBeenCalledTimes(configCount);
    },
  );

  it("keeps a failed stage forward-only and performs no compensating rollback", async () => {
    const fingerprint = await workspaceInitializationFingerprint(
      "reef-sample",
      config,
    );
    mocks.readMarker.mockResolvedValue(
      stored("writer_registered", fingerprint),
    );
    mocks.reconcile.mockRejectedValueOnce(new Error("provision failed"));

    await expect(
      initializeWorkspace({
        adapter: { request: vi.fn() },
        request: { name: "reef-sample", config },
        serviceUsername: "reef-schema",
      }),
    ).rejects.toThrow("provision failed");
    expect(mocks.advanceMarker).not.toHaveBeenCalled();
    expect(mocks.grantMember).not.toHaveBeenCalled();
    expect(mocks.createVault).not.toHaveBeenCalled();
  });

  it("restores and rechecks writer membership before advancing ready", async () => {
    const fingerprint = await workspaceInitializationFingerprint(
      "reef-sample",
      config,
    );
    mocks.readMarker.mockResolvedValue(stored("skill_installed", fingerprint));
    mocks.listMembers.mockResolvedValueOnce({ members: [] }).mockResolvedValue({
      members: [{ username: "reef-schema", role: "writer" }],
    });

    await initializeWorkspace({
      adapter: { request: vi.fn() },
      request: { name: "reef-sample", config },
      serviceUsername: "reef-schema",
    });

    expect(mocks.grantMember).toHaveBeenCalledOnce();
    expect(mocks.advanceMarker).toHaveBeenCalledWith(
      expect.anything(),
      "reef-sample",
      expect.objectContaining({
        marker: expect.objectContaining({ state: "skill_installed" }),
      }),
      "ready",
    );
    expect(mocks.listMembers.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("verifies every durable prerequisite after an OCC winner fast-forwards the marker", async () => {
    const fingerprint = await workspaceInitializationFingerprint(
      "reef-sample",
      config,
    );
    mocks.readMarker.mockResolvedValue(stored("initializing", fingerprint));
    mocks.advanceMarker.mockResolvedValueOnce(stored("ready", fingerprint));

    await initializeWorkspace({
      adapter: { request: vi.fn() },
      request: { name: "reef-sample", config },
      serviceUsername: "reef-schema",
    });

    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.installSkillDocuments).not.toHaveBeenCalled();
    expect(mocks.writeInitialConfig).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalled();
    expect(mocks.skillStatus).toHaveBeenCalled();
    expect(mocks.readConfig).toHaveBeenCalled();
  });

  it("requires a configured service username before creating a vault", async () => {
    await expect(
      initializeWorkspace({
        adapter: { request: vi.fn() },
        request: { name: "reef-sample", config },
        serviceUsername: " ",
      }),
    ).rejects.toBeInstanceOf(SchemaLifecycleError);
    expect(mocks.listVaults).not.toHaveBeenCalled();
  });
});
