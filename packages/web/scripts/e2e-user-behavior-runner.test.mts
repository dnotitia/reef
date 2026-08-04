// @vitest-environment node

import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  packRunnerArtifact,
  redactText,
  validateScenarioInput,
} from "./e2e-user-behavior-runner.cjs";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const runnerPath = fileURLToPath(
  new URL("./e2e-user-behavior-runner.cjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function scenario() {
  return {
    schema_version: 1,
    scenario: "global-search-content",
    clause_id: "search-content-presentation",
    target_url: "https://reef-candidate.test",
    workspace: "reef-e2e",
    search_placeholder: "Search issues...",
    metadata_query: "Initial issue Alpha",
    content_query: "comment-only lighthouse",
    credentials: {
      username_env: "REEF_E2E_USERNAME",
      password_env: "REEF_E2E_PASSWORD",
    },
    expected: {
      field_heading: "Issue field matches",
      content_heading: "Issue content matches",
      issue_id: "REEF-003",
      title: "Backlog issue Gamma",
      source: "Comment",
      snippet: "comment-only lighthouse",
    },
  };
}

describe("portable E2E user-behavior runner", () => {
  it("accepts source-neutral expectations and credential environment names", () => {
    expect(validateScenarioInput(scenario())).toEqual(scenario());
    expect(() =>
      validateScenarioInput({
        ...scenario(),
        credentials: {
          username_env: "alice",
          password_env: "password",
        },
      }),
    ).toThrow(/environment-variable name/);
  });

  it("redacts credential values from failure text", () => {
    expect(
      redactText("login alice failed with password", ["alice", "password"]),
    ).toBe("login [REDACTED] failed with [REDACTED]");
  });

  it("packs one executable checkout-independent artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-e2e-runner-test-"));
    temporaryDirectories.push(root);
    const output = join(root, "reef-e2e-runner.cjs");
    const artifact = await packRunnerArtifact(output);

    expect(artifact.path).toBe(output);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(output)).mode & 0o111).not.toBe(0);
    expect(await readFile(output, "utf8")).toContain("global-search-content");
    const help = await execFileAsync(output, ["--help"]);
    expect(help.stdout).toContain("--candidate-head SHA");
  });

  it("writes a private redacted blocked report when runtime credentials are unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-e2e-runner-report-test-"));
    temporaryDirectories.push(root);
    const input = join(root, "input");
    const output = join(root, "output");
    await mkdir(input);
    await writeFile(join(input, "scenario.json"), JSON.stringify(scenario()), {
      mode: 0o600,
    });

    await execFileAsync(process.execPath, [
      runnerPath,
      "--input-dir",
      input,
      "--output-dir",
      output,
      "--candidate-head",
      "a".repeat(40),
    ]);

    const reportPath = join(output, "behavior-report.json");
    const transcriptPath = join(output, "redacted-transcript.jsonl");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const transcript = await readFile(transcriptPath, "utf8");
    expect(report).toMatchObject({
      candidate_head: "a".repeat(40),
      status: "blocked",
      clauses: [
        {
          id: "search-content-presentation",
          status: "blocked",
          evidence: ["redacted-transcript.jsonl"],
        },
      ],
    });
    expect(transcript).not.toContain("alice");
    expect(transcript).not.toContain("password");
    expect((await stat(reportPath)).mode & 0o077).toBe(0);
    expect((await stat(transcriptPath)).mode & 0o077).toBe(0);
  });
});
