import { vi } from "vitest";

vi.mock("@/server/adapters/workspaceInstallation", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/adapters/workspaceInstallation")
  >("@/server/adapters/workspaceInstallation");
  return {
    ...actual,
    requireWorkspaceActive: vi.fn(async () => undefined),
    requireWorkspaceReady: vi.fn(async () => ({
      installation_status: "ready" as const,
    })),
  };
});
