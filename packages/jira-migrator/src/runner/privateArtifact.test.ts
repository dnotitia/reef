import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireMigrationRunLock,
  readPrivatePlanArtifact,
  writePrivatePlanArtifact,
} from "./privateArtifact.js";

const directories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "reef-private-plan-"));
  directories.push(directory);
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("private migration artifacts", () => {
  it("writes an immutable private plan with verified readback", async () => {
    const path = join(await temporaryDirectory(), "report.plan.json");
    const artifact = {
      schema_version: 1 as const,
      run_id: "run-1",
      source: {
        jira_cloud_id: "cloud-1",
        project_keys: ["ALPHA"],
        board_ids: [],
      },
      target: { vault: "reef-test", actor: "operator" },
      plan_sha256: "a".repeat(64),
      payload: { exact: ["write", "plan"] },
    };
    await writePrivatePlanArtifact(path, artifact);
    await writePrivatePlanArtifact(path, artifact);
    await expect(readPrivatePlanArtifact(path)).resolves.toEqual(artifact);
    await expect(
      writePrivatePlanArtifact(path, {
        ...artifact,
        payload: { exact: ["changed"] },
      }),
    ).rejects.toThrow("private_plan_artifact_immutable");
  });

  it("uses an OS-backed lifetime lock that releases with its server", async () => {
    const path = join(await temporaryDirectory(), "ledger.run.lock");
    const release = await acquireMigrationRunLock(path);
    await expect(acquireMigrationRunLock(path)).rejects.toThrow(
      "migration_run_lock_conflict",
    );
    await release();
    const releaseNext = await acquireMigrationRunLock(path);
    await releaseNext();
  });
});
