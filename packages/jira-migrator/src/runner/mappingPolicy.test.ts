import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadJiraMappingPolicy } from "./mappingPolicy.js";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("loadJiraMappingPolicy", () => {
  it("loads explicit tenant field overrides", async () => {
    root = await mkdtemp(join(tmpdir(), "reef-jira-policy-"));
    const path = join(root, "policy.json");
    await writeFile(
      path,
      JSON.stringify({
        statuses: [],
        issueTypes: [],
        priorities: [],
        fieldOverrides: {
          sprint: "customfield_10020",
          story_points: "customfield_10016",
          start_date: "customfield_10015",
          rank: "customfield_10019",
        },
      }),
      { mode: 0o600 },
    );

    await expect(loadJiraMappingPolicy(path)).resolves.toMatchObject({
      fieldOverrides: {
        sprint: "customfield_10020",
        story_points: "customfield_10016",
        start_date: "customfield_10015",
        rank: "customfield_10019",
      },
      linkMappings: [],
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects group/world-readable policy files",
    async () => {
      root = await mkdtemp(join(tmpdir(), "reef-jira-policy-"));
      const path = join(root, "policy.json");
      await writeFile(
        path,
        JSON.stringify({ statuses: [], issueTypes: [], priorities: [] }),
        { mode: 0o600 },
      );
      await chmod(path, 0o644);

      await expect(loadJiraMappingPolicy(path)).rejects.toMatchObject({
        code: "unsafe_file",
      });
    },
  );
});
