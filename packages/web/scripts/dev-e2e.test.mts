// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReadyPayload,
  buildRuntimeCommand,
  getClientReadinessInputs,
  parseOptions,
  validateResetBody,
  validateScenario,
  writeReadyFile,
} from "./dev-e2e.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("dev:e2e runtime contract", () => {
  it("pre-builds the runtime workspace through the canonical Turbo graph", () => {
    expect(buildRuntimeCommand()).toMatchObject({
      args: ["exec", "turbo", "run", "build", "--filter=@reef/web"],
    });
    expect(buildRuntimeCommand().command).toMatch(/^pnpm(?:\.cmd)?$/u);
  });

  it("accepts a source-owned scenario and an explicit ready-file path", () => {
    const options = parseOptions(
      ["--ready-file", "/tmp/reef-ready.json", "--", "comment_mentions"],
      {
        NODE_ENV: "test",
        REEF_WEB_URL: "http://localhost:9135",
        REEF_E2E_MOCK_URL: "http://127.0.0.1:9136",
      },
    );

    expect(options).toMatchObject({
      scenario: "comment_mentions",
      readyFile: "/tmp/reef-ready.json",
      webOrigin: "http://localhost:9135",
      webPort: "9135",
      fixtureOrigin: "http://127.0.0.1:9136",
      fixtureHost: "127.0.0.1",
      fixturePort: "9136",
    });
  });

  it("keeps scenario validation safe while letting the fixture define support", () => {
    expect(validateScenario("future_fixture_scenario")).toBe(
      "future_fixture_scenario",
    );
    expect(
      validateResetBody(
        { ok: true, scenario: "comment_mentions" },
        "comment_mentions",
      ),
    ).toMatchObject({ scenario: "comment_mentions" });
    expect(validateScenario("future-fixture-scenario")).toBe(
      "future-fixture-scenario",
    );
    expect(() => validateScenario("../comment_mentions")).toThrow(
      /letters, numbers/,
    );
    expect(() =>
      validateResetBody(
        { ok: true, scenario: "configured" },
        "future_fixture_scenario",
      ),
    ).toThrow(/rejected scenario/);
  });

  it("requires the fixture's browser login and workspace entrypoint contract", () => {
    expect(
      getClientReadinessInputs({
        status: "ready",
        fixture_login: {
          username: "alice",
          password: "fixture-password",
          login_path: "/login?password=1",
        },
        tasks: { chat: { start_path: "/workspace/reef-e2e/issues" } },
      }),
    ).toEqual({
      username: "alice",
      password: "fixture-password",
      loginPath: "/login?password=1",
      startPath: "/workspace/reef-e2e/issues",
    });
    expect(() =>
      getClientReadinessInputs({
        status: "ready",
        fixture_login: { username: "alice" },
        tasks: { chat: { start_path: "/workspace/reef-e2e/issues" } },
      }),
    ).toThrow(/fixture login password/);
  });

  it("writes a private runtime ready descriptor", async () => {
    const root = await mkdtemp(join(tmpdir(), "reef-dev-e2e-contract-test-"));
    temporaryDirectories.push(root);
    const readyFile = join(root, "ready.json");
    const payload = buildReadyPayload({
      webOrigin: "http://localhost:9135",
      fixtureOrigin: "http://127.0.0.1:9136",
      scenario: "comment_mentions",
    });

    await writeReadyFile(readyFile, payload);

    expect(payload).toEqual({
      schema_version: 2,
      status: "ready",
      scenario: "comment_mentions",
      services: {
        web: {
          origin: "http://localhost:9135",
          health: { method: "GET", url: "http://localhost:9135" },
          readiness: { mode: "browser", status: "ready" },
        },
        fixture: {
          origin: "http://127.0.0.1:9136",
          health: {
            method: "GET",
            url: "http://127.0.0.1:9136/__e2e/health",
          },
          reset: {
            method: "POST",
            url: "http://127.0.0.1:9136/__e2e/reset",
            content_type: "application/json",
            body: { scenario: "comment_mentions" },
          },
          discovery: {
            method: "GET",
            url: "http://127.0.0.1:9136/__e2e/runtime",
          },
        },
      },
    });
    expect(Object.keys(payload)).not.toContain("pid");
    expect(Object.keys(payload)).not.toContain("candidate_head");
    expect(JSON.parse(await readFile(readyFile, "utf8"))).toEqual(payload);
    expect((await stat(readyFile)).mode & 0o077).toBe(0);
  });
});
