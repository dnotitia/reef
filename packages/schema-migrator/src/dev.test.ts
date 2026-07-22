import type { ChildProcess, spawn } from "node:child_process";
// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { migrationFreeEnvironment, runDev } from "../../../scripts/dev";

function child() {
  const process = new EventEmitter() as ChildProcess;
  process.kill = vi.fn(() => true);
  return process;
}

describe("root development orchestration", () => {
  it("strips migration-only credentials from the web environment", () => {
    expect(
      migrationFreeEnvironment({
        REEF_SCHEMA_MIGRATION_KEY: "DO_NOT_LEAK_SECRET",
        AKB_BACKEND_URL: "https://akb.example",
      }),
    ).toEqual({ AKB_BACKEND_URL: "https://akb.example" });
  });

  it("runs migration exactly once and does not spawn web after failure", async () => {
    const migration = child();
    const spawnSpy = vi.fn(() => migration);
    const result = runDev(spawnSpy as unknown as typeof spawn, {});
    migration.emit("exit", 7, null);

    await expect(result).resolves.toBe(7);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it("starts web after success, strips its secret, and forwards signals", async () => {
    const migration = child();
    const web = child();
    const spawnSpy = vi
      .fn()
      .mockReturnValueOnce(migration)
      .mockReturnValueOnce(web);
    const result = runDev(spawnSpy as unknown as typeof spawn, {
      REEF_SCHEMA_MIGRATION_KEY: "DO_NOT_LEAK_SECRET",
      AKB_BACKEND_URL: "https://akb.example",
    });
    migration.emit("exit", 0, null);
    await Promise.resolve();
    process.emit("SIGTERM", "SIGTERM");
    web.emit("exit", 0, null);

    await expect(result).resolves.toBe(0);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(spawnSpy.mock.calls[1]?.[2]?.env).not.toHaveProperty(
      "REEF_SCHEMA_MIGRATION_KEY",
    );
    expect(web.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
