import { vi } from "vitest";

vi.mock("@/server/adapters/workspaceInstallation", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/adapters/workspaceInstallation")
  >("@/server/adapters/workspaceInstallation");
  return {
    ...actual,
    requireWorkspaceReady: vi.fn(async () => ({
      installation_status: "ready" as const,
    })),
  };
});
