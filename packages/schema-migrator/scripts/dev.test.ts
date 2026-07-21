import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { developmentChildEnvironment, startDevelopment } from "./dev";

const ENV = {
  AKB_BACKEND_URL: "http://127.0.0.1:8000",
  REEF_AKB_MIGRATION_SERVICE_KEY: "REEF_SENTINEL_SUPER_SECRET",
  REEF_AKB_MIGRATION_SERVICE_ACCOUNT: "reef-migrator",
  KEEP_ME: "yes",
};

describe("local development wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not spawn Next.js when migration fails", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const spawnProcess = vi.fn();
    await expect(
      startDevelopment({
        env: ENV,
        runMigration: vi.fn().mockRejectedValue(new Error("injected")),
        spawnProcess,
      }),
    ).resolves.toBe(1);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("runs migration once, spawns Next.js once, and strips the key from child env", async () => {
    const child = new EventEmitter();
    const runMigration = vi.fn().mockResolvedValue(undefined);
    const spawnProcess = vi.fn().mockImplementation(() => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    });

    await expect(
      startDevelopment({ env: ENV, runMigration, spawnProcess }),
    ).resolves.toBe(0);

    expect(runMigration).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const options = spawnProcess.mock.calls[0]?.[2];
    expect(options.env.REEF_AKB_MIGRATION_SERVICE_KEY).toBeUndefined();
    expect(options.env.REEF_AKB_MIGRATION_SERVICE_ACCOUNT).toBe(
      "reef-migrator",
    );
    expect(options.env.KEEP_ME).toBe("yes");
  });

  it("returns a fresh environment object without mutating the parent", () => {
    const child = developmentChildEnvironment(ENV);
    expect(child).not.toBe(ENV);
    expect(ENV.REEF_AKB_MIGRATION_SERVICE_KEY).toBe(
      "REEF_SENTINEL_SUPER_SECRET",
    );
    expect(child.REEF_AKB_MIGRATION_SERVICE_KEY).toBeUndefined();
  });
});
