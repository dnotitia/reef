import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireMigrationRunLock,
  assertNoSymlinkPathComponents,
  processIdentityMayOwnLiveLock,
  readPrivatePlanArtifact,
  writePrivatePlanArtifact,
} from "./privateArtifact.js";

const directories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "reef-private-plan-"));
  directories.push(directory);
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return realpath(directory);
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("private migration artifacts", () => {
  it("does not reclaim a live lock when strong process identity is unavailable", () => {
    expect(
      processIdentityMayOwnLiveLock(
        42,
        "darwin:42:strong-start-time",
        "pid:42",
      ),
    ).toBe(true);
    expect(
      processIdentityMayOwnLiveLock(
        42,
        "darwin:42:old-start-time",
        "darwin:42:new-start-time",
      ),
    ).toBe(false);
    expect(
      processIdentityMayOwnLiveLock(42, "darwin:42:old-start-time", null),
    ).toBe(false);
  });

  it("writes an immutable private plan with verified readback", async () => {
    const path = join(await temporaryDirectory(), "report.plan.json");
    const artifact = {
      schema_version: 1 as const,
      run_id: "run-1",
      source: {
        jira_cloud_id: "cloud-1",
        project_keys: ["ALPHA"],
        board_ids: [],
        endpoint_fingerprint: "c".repeat(64),
      },
      target: {
        vault: "reef-test",
        actor: "operator",
        endpoint_fingerprint: "b".repeat(64),
      },
      plan_sha256: "a".repeat(64),
      approval_report_sha256: "d".repeat(64),
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

  it.skipIf(process.platform === "win32")(
    "rejects a symlink in an artifact path ancestor",
    async () => {
      const root = await temporaryDirectory();
      const target = join(root, "target");
      const link = join(root, "redirect");
      await mkdir(target, { mode: 0o700 });
      await symlink(target, link, "dir");

      await expect(
        assertNoSymlinkPathComponents(join(link, "report.plan.json")),
      ).rejects.toThrow("private_artifact_symlink");
    },
  );

  it("rejects parent traversal before normalizing an artifact path", async () => {
    const root = await temporaryDirectory();

    await expect(
      assertNoSymlinkPathComponents(
        `${root}/untrusted-link/../report.plan.json`,
      ),
    ).rejects.toThrow("private_artifact_parent_segment");
  });
});
