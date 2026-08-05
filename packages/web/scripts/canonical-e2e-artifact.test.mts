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
import { loginToWorkspace } from "../tests/e2e/behaviors/runtime.cjs";
import {
  LARGE_ISSUE_LIST_CLAUSES,
  packCanonicalArtifact,
  redactText,
  reportReason,
  saveEvidence,
  validateBehaviorInput,
} from "./canonical-e2e-artifact.cjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL("./canonical-e2e-artifact.cjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function behaviorInput(
  behavior:
    | "content-search"
    | "issue-list-virtualization"
    | "named-issue-filters" = "content-search",
) {
  return {
    schema_version: 1,
    behavior,
    contract_clause: "B2",
    runtime: {
      web_origin: "http://localhost:7353",
      fixture_origin: "http://127.0.0.1:7354",
      workspace: "reef-e2e",
      reset_scenario:
        behavior === "content-search"
          ? "content_search"
          : behavior === "issue-list-virtualization"
            ? "large_vault"
            : "configured_multi",
    },
    credentials: {
      username_env: "REEF_MISSING_USERNAME",
      password_env: "REEF_MISSING_PASSWORD",
    },
    evidence: ["screenshot", "accessibility", "details"],
  };
}

describe("canonical E2E artifact adapter", () => {
  it("accepts only source-neutral behavior bindings", () => {
    for (const behavior of [
      "content-search",
      "issue-list-virtualization",
      "named-issue-filters",
    ] as const) {
      expect(validateBehaviorInput(behaviorInput(behavior))).toMatchObject({
        schema_version: 1,
        behavior,
        contract_clause: "B2",
      });
    }

    expect(() =>
      validateBehaviorInput({
        ...behaviorInput(),
        expected: { issue_id: "candidate-controlled" },
      }),
    ).toThrow(/unsupported field/);
    expect(() =>
      validateBehaviorInput({
        ...behaviorInput(),
        runtime: {
          ...behaviorInput().runtime,
          selector: "[data-testid=anything]",
        },
      }),
    ).toThrow(/unsupported field/);
    const credentialedOrigin = new URL("https://candidate.test");
    credentialedOrigin.username = "fixture";
    credentialedOrigin.password = "placeholder";
    expect(() =>
      validateBehaviorInput({
        ...behaviorInput(),
        runtime: {
          ...behaviorInput().runtime,
          web_origin: credentialedOrigin.toString(),
        },
      }),
    ).toThrow(/credentials/);
  });

  it("redacts credential values and keeps report reasons terminal", () => {
    expect(
      redactText("login fixture-user failed with fixture-pass", [
        "fixture-user",
        "fixture-pass",
      ]),
    ).toBe("login [REDACTED] failed with [REDACTED]");
    expect(reportReason("pass", undefined)).toBeNull();
    expect(reportReason("fail", undefined)).toBeNull();
    expect(reportReason("blocked", "blocked_external_auth")).toBe(
      "blocked_external_auth",
    );
  });

  it("redacts credential values from accessibility and detail evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-canonical-evidence-test-"));
    temporaryDirectories.push(root);
    const outputDir = join(root, "output");
    await mkdir(outputDir);
    const input = {
      behavior: "content-search",
      evidence: ["accessibility", "details"],
    };
    const page = {
      locator: () => ({
        ariaSnapshot: async () =>
          "button name=fixture-user; text=fixture-pass;",
      }),
    };

    const evidence = await saveEvidence(
      outputDir,
      input,
      {
        details: {
          username: "fixture-user",
          password: "fixture-pass",
        },
      },
      page,
      ["fixture-user", "fixture-pass"],
    );

    expect(evidence).toEqual([
      "content-search.aria.txt",
      "content-search.json",
    ]);
    for (const file of evidence) {
      const contents = await readFile(join(outputDir, file), "utf8");
      expect(contents).not.toContain("fixture-user");
      expect(contents).not.toContain("fixture-pass");
      expect((await stat(join(outputDir, file))).mode & 0o077).toBe(0);
    }
  });

  it("waits for the hydrated workspace shell before canonical behavior starts", async () => {
    const events: string[] = [];
    const locator = (selector: string) => ({
      waitFor: async ({ state }: { state: string }) => {
        events.push(`${selector}:${state}`);
      },
      fill: async () => undefined,
      click: async () => undefined,
    });
    const page = {
      goto: async () => undefined,
      locator,
      keyboard: {
        press: async (key: string) => {
          events.push(`key:${key}`);
        },
      },
      waitForResponse: async (predicate: (response: unknown) => boolean) => {
        const response = {
          url: () => "http://localhost/api/auth/akb/login",
          request: () => ({ method: () => "POST" }),
          ok: () => true,
          status: () => 200,
        };
        expect(predicate(response)).toBe(true);
        return response;
      },
      waitForURL: async (predicate: (url: URL) => boolean) => {
        expect(
          predicate(new URL("http://localhost/workspace/reef-e2e/issues")),
        ).toBe(true);
      },
    };

    await loginToWorkspace(page, {
      webOrigin: "http://localhost:7353",
      workspace: "reef-e2e",
      credentials: { username: "fixture-user", password: "fixture-pass" },
    });

    expect(events.slice(-4)).toEqual([
      "key:Control+K",
      '[data-testid="global-search-input"]:visible',
      "key:Escape",
      '[data-testid="global-search-input"]:hidden',
    ]);
  });

  it("packs one executable artifact with the generic launcher interface", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-canonical-artifact-test-"));
    temporaryDirectories.push(root);
    const output = join(root, "canonical-e2e-artifact.cjs");
    const artifact = await packCanonicalArtifact(output);

    expect(artifact.path).toBe(output);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect((await stat(output)).mode & 0o111).not.toBe(0);
    const source = await readFile(output, "utf8");
    expect(source).toContain("behavior-input.json");

    const help = await execFileAsync(output, ["--help"]);
    expect(help.stdout).toContain("--input-dir PATH");
    expect(help.stdout).toContain("--output-dir PATH");
    expect(help.stdout).toContain("--candidate-head SHA");
  });

  it("writes a private blocked report without credential values", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-canonical-report-test-"));
    temporaryDirectories.push(root);
    const inputDir = join(root, "input");
    const outputDir = join(root, "output");
    await mkdir(inputDir);
    await writeFile(
      join(inputDir, "behavior-input.json"),
      `${JSON.stringify(behaviorInput())}\n`,
      { mode: 0o600 },
    );

    await execFileAsync(process.execPath, [
      scriptPath,
      "--input-dir",
      inputDir,
      "--output-dir",
      outputDir,
      "--candidate-head",
      "a".repeat(40),
    ]);

    const reportPath = join(outputDir, "behavior-report.json");
    const transcriptPath = join(outputDir, "redacted-transcript.jsonl");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const transcript = await readFile(transcriptPath, "utf8");
    expect(report).toMatchObject({
      candidate_head: "a".repeat(40),
      status: "blocked",
      reason: "blocked_external_auth",
      clauses: [
        {
          id: "B2:content-search",
          status: "blocked",
          evidence: ["redacted-transcript.jsonl"],
        },
      ],
    });
    expect(transcript).not.toContain("fixture-user");
    expect(transcript).not.toContain("fixture-pass");
    expect((await stat(reportPath)).mode & 0o077).toBe(0);
    expect((await stat(transcriptPath)).mode & 0o077).toBe(0);
  });

  it("reports each large-list clause when authentication is unavailable", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "reef-canonical-list-report-test-"),
    );
    temporaryDirectories.push(root);
    const inputDir = join(root, "input");
    const outputDir = join(root, "output");
    await mkdir(inputDir);
    await writeFile(
      join(inputDir, "behavior-input.json"),
      `${JSON.stringify(behaviorInput("issue-list-virtualization"))}\n`,
      { mode: 0o600 },
    );

    await execFileAsync(process.execPath, [
      scriptPath,
      "--input-dir",
      inputDir,
      "--output-dir",
      outputDir,
      "--candidate-head",
      "b".repeat(40),
    ]);

    const report = JSON.parse(
      await readFile(join(outputDir, "behavior-report.json"), "utf8"),
    );
    expect(report.status).toBe("blocked");
    expect(report.reason).toBe("blocked_external_auth");
    expect(report.clauses.map((clause: { id: string }) => clause.id)).toEqual(
      LARGE_ISSUE_LIST_CLAUSES,
    );
    expect(
      report.clauses.every(
        (clause: { status: string; evidence: string[] }) =>
          clause.status === "blocked" &&
          clause.evidence.includes("redacted-transcript.jsonl"),
      ),
    ).toBe(true);
  });
});
