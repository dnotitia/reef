import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jiraIssueFixture } from "../jira/fixtures.js";
import { JiraIssueSchema } from "../payloads.js";
import {
  JiraAccountMappingFileError,
  loadJiraAccountMappingArtifact,
  writeJiraAccountMappingArtifact,
} from "./artifactFile.js";
import {
  collectJiraUserObservations,
  mapJiraIssueActors,
  upsertJiraAccountMappingArtifact,
} from "./mapping.js";

let tempDir: string | null = null;

const makeTempDir = async (): Promise<string> => {
  tempDir = await mkdtemp(join(tmpdir(), "reef-jira-mapping-"));
  return tempDir;
};

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("Jira account mapping file", () => {
  it("creates a missing artifact, writes it, and reloads operator overrides", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "jira-account-mapping.cloud-abc.json");
    const issue = JiraIssueSchema.parse(jiraIssueFixture);

    const empty = await loadJiraAccountMappingArtifact({
      path,
      jiraCloudId: "cloud-abc",
    });
    expect(empty).toEqual({
      version: 1,
      jiraCloudId: "cloud-abc",
      accounts: {},
      overrides: {},
    });

    const upserted = upsertJiraAccountMappingArtifact({
      artifact: empty,
      observations: collectJiraUserObservations({ issue }),
      directory: [],
      observedAt: "2026-07-09T08:00:00.000Z",
    }).artifact;
    const artifact = {
      ...upserted,
      overrides: {
        ...upserted.overrides,
        "acct-reporter": {
          actor: "reef-requester",
          reason: "operator confirmed requester account",
        },
      },
    };
    await writeJiraAccountMappingArtifact(path, artifact);

    const raw = await readFile(path, "utf8");
    expect(raw).toContain('"overrides"');
    expect(raw).toContain('"acct-reporter"');
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await chmod(path, 0o644);
      await writeJiraAccountMappingArtifact(path, artifact);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }

    const reloaded = await loadJiraAccountMappingArtifact({
      path,
      jiraCloudId: "cloud-abc",
    });
    expect(mapJiraIssueActors(issue, { artifact: reloaded })).toMatchObject({
      reporter: {
        actor: "reef-requester",
        strategy: "override",
        overrideReason: "operator confirmed requester account",
      },
      requester: {
        actor: "reef-requester",
        strategy: "override",
        overrideReason: "operator confirmed requester account",
      },
    });
  });

  it("rejects invalid JSON and cloud-id mismatches before applying overrides", async () => {
    const dir = await makeTempDir();
    const invalidPath = join(dir, "invalid.json");
    await writeFile(invalidPath, "{", { encoding: "utf8", mode: 0o600 });

    await expect(
      loadJiraAccountMappingArtifact({
        path: invalidPath,
        jiraCloudId: "cloud-abc",
      }),
    ).rejects.toThrow(JiraAccountMappingFileError);

    const wrongCloudPath = join(dir, "wrong-cloud.json");
    await writeFile(
      wrongCloudPath,
      JSON.stringify({
        version: 1,
        jiraCloudId: "cloud-other",
        accounts: {},
        overrides: {},
      }),
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(
      loadJiraAccountMappingArtifact({
        path: wrongCloudPath,
        jiraCloudId: "cloud-abc",
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining("does not match")],
    });
  });

  it("replaces a mapping symlink without modifying its target", async () => {
    const dir = await makeTempDir();
    const target = join(dir, "target.json");
    const path = join(dir, "mapping.json");
    await writeFile(target, "unchanged\n", { mode: 0o600 });
    await symlink(target, path);

    await expect(
      loadJiraAccountMappingArtifact({
        path,
        jiraCloudId: "cloud-abc",
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining("private regular file")],
    });

    await writeJiraAccountMappingArtifact(path, {
      version: 1,
      jiraCloudId: "cloud-abc",
      accounts: {},
      overrides: {},
    });

    expect(await readFile(target, "utf8")).toBe("unchanged\n");
    expect((await stat(path)).isFile()).toBe(true);
    expect(await readFile(path, "utf8")).toContain('"jiraCloudId"');
  });
});
