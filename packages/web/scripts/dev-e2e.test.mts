// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReadyPayload,
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

  it("writes only the minimal private ready payload", async () => {
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
      schema_version: 1,
      status: "ready",
      origin: "http://localhost:9135",
      fixture_origin: "http://127.0.0.1:9136",
      reset_url: "http://127.0.0.1:9136/__e2e/reset",
      scenario: "comment_mentions",
    });
    expect(Object.keys(payload)).not.toContain("pid");
    expect(Object.keys(payload)).not.toContain("candidate_head");
    expect(JSON.parse(await readFile(readyFile, "utf8"))).toEqual(payload);
    expect((await stat(readyFile)).mode & 0o077).toBe(0);
  });
});
