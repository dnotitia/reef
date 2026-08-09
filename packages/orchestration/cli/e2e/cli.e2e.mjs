import assert from "node:assert/strict";
import test from "node:test";

import { createFixture, environmentWithout, pathExists } from "./fixture.mjs";

const sensitiveValues = (fixture) => [
  fixture.environment.REEF_AKB_JWT,
  fixture.environment.GITHUB_TOKEN,
  fixture.environment.INFRA_SECRET,
  fixture.environment.VALIDATION_SECRET,
];

const assertTerminalProcess = (result, code, outcome) => {
  assert.equal(result.code, code);
  assert.equal(result.signal, null);
  const stdoutLines = result.stdout.trimEnd().split("\n");
  assert.equal(
    stdoutLines.length,
    1,
    `stdout must contain one line: ${result.stdout}`,
  );
  assert.ok(result.terminal, `terminal JSON missing: ${result.stdout}`);
  assert.equal(result.terminal.outcome, outcome);
};

const assertNoSensitiveOutput = async (fixture, result) => {
  const output = [
    result.stdout,
    result.stderr,
    JSON.stringify(result.terminal),
  ].join("\n");
  assert.ok(
    !output.includes(fixture.root),
    "private fixture root leaked into CLI output",
  );
  for (const value of sensitiveValues(fixture)) {
    assert.ok(
      !output.includes(value),
      "fixture credential leaked into CLI output",
    );
  }
  for (const file of await fixture.controllerFiles()) {
    assert.ok(
      !file.content.includes(fixture.root),
      `private path leaked into ${file.path}`,
    );
    for (const value of sensitiveValues(fixture)) {
      assert.ok(
        !file.content.includes(value),
        `credential leaked into ${file.path}`,
      );
    }
  }
};

const assertPhaseStream = (
  result,
  expected = ["preflight", "running", "cleanup", "terminal"],
) => {
  assert.deepEqual(
    result.events.map((event) => event.phase),
    expected,
  );
  for (const line of result.stderr.trim().split("\n")) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
};

const disposeFixture = async (fixture) => {
  await fixture.dispose();
  assert.equal(await pathExists(fixture.root), false);
  await assert.rejects(fetch(`${fixture.baseUrl}/api/v1/auth/me`));
};

test("runs the built dist/cli.js through real provider resolution with one terminal line", async () => {
  const fixture = await createFixture({ runWindowMs: 10 });
  try {
    const process = fixture.spawnCli();
    const result = await process.result;

    assertTerminalProcess(result, 0, "succeeded");
    assertPhaseStream(result);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(result.terminal.plan.providers).map(
          ([kind, provider]) => [kind, provider.id],
        ),
      ),
      {
        work: "reef",
        harness: "codex",
        infrastructure: "local",
        scm: "github",
        validation: "local-validation",
      },
    );
    assert.ok(
      fixture.requests.some(({ path }) =>
        path.endsWith(`/documents/${"fixture-vault"}/issues/reef-101.md`),
      ),
    );
    assert.ok(fixture.requests.some(({ path }) => path === "/api/v1/auth/me"));
    const githubArtifact = await fixture.exerciseGithubAdapter();
    assert.deepEqual(githubArtifact, {
      kind: "pull_request",
      ref: "1",
      uri: "https://github.com/fixture/reef/pull/1",
      title: "Fixture draft pull request",
    });
    assert.ok(
      fixture.requests.some(
        ({ method, path }) =>
          method === "GET" && path === "/github/repos/fixture/reef/pulls",
      ),
    );
    assert.ok(
      fixture.requests.some(
        ({ method, path }) =>
          method === "POST" && path === "/github/repos/fixture/reef/pulls",
      ),
    );
    await assertNoSensitiveOutput(fixture, result);
  } finally {
    await disposeFixture(fixture);
  }
});

test("returns stable config, provider-resolution, and upstream failure terminals before leaking resources", async () => {
  const fixture = await createFixture({ runWindowMs: 10 });
  try {
    const invalid = await fixture.spawnCli({
      configPath: fixture.invalidConfigPath,
    }).result;
    assertTerminalProcess(invalid, 2, "failed");
    assert.equal(invalid.terminal.failure.code, "config_invalid");
    assert.equal((await fixture.controllerFiles()).length, 0);

    const providerMismatch = await fixture.spawnCli({
      configPath: fixture.providerMismatchConfigPath,
    }).result;
    assertTerminalProcess(providerMismatch, 2, "failed");
    assert.equal(
      providerMismatch.terminal.failure.code,
      "provider_unsupported",
    );
    assert.equal((await fixture.controllerFiles()).length, 0);

    const missingEnvironment = await fixture.spawnCli({
      environment: environmentWithout(fixture, "REEF_AKB_JWT"),
    }).result;
    assertTerminalProcess(missingEnvironment, 2, "failed");
    assert.equal(
      missingEnvironment.terminal.failure.code,
      "environment_missing",
    );
    assert.equal((await fixture.controllerFiles()).length, 0);

    fixture.setWorkReadFailure(true);
    const upstreamFailure = await fixture.spawnCli().result;
    assertTerminalProcess(upstreamFailure, 1, "failed");
    assert.equal(upstreamFailure.terminal.failure.code, "work_read_failed");
    assert.equal((await fixture.controllerFiles()).length, 0);
    for (const result of [
      invalid,
      providerMismatch,
      missingEnvironment,
      upstreamFailure,
    ]) {
      await assertNoSensitiveOutput(fixture, result);
    }
  } finally {
    await disposeFixture(fixture);
  }
});

test("blocks a duplicate active claim without reclaiming the first process", async () => {
  const fixture = await createFixture({ runWindowMs: 5_000 });
  try {
    const first = fixture.spawnCli();
    await first.waitForPhase("running");

    const blocked = await fixture.spawnCli().result;
    assertTerminalProcess(blocked, 3, "blocked");
    assert.equal(blocked.terminal.failure.code, "duplicate_work");
    assert.equal(
      blocked.terminal.controller.existing_run.work_uri,
      fixture.workUri,
    );
    assert.equal(first.child.exitCode, null);

    first.child.kill("SIGINT");
    const firstResult = await first.result;
    assertTerminalProcess(firstResult, 130, "cancelled");
    assertPhaseStream(firstResult);
    await assertNoSensitiveOutput(fixture, blocked);
    await assertNoSensitiveOutput(fixture, firstResult);
  } finally {
    await disposeFixture(fixture);
  }
});

test("turns SIGINT into a cancelled terminal result and releases controller state for cleanup", async () => {
  const fixture = await createFixture({ runWindowMs: 5_000 });
  try {
    const running = fixture.spawnCli();
    await running.waitForPhase("running");
    running.child.kill("SIGINT");
    const result = await running.result;

    assertTerminalProcess(result, 130, "cancelled");
    assertPhaseStream(result);
    assert.equal(result.terminal.failure.code, "cancelled");
    assert.deepEqual(result.terminal.cleanup.outcomes, []);
    const states = await fixture.controllerFiles();
    assert.equal(states.length, 2);
    const parsedStates = states.map(({ content }) => JSON.parse(content));
    assert.ok(parsedStates.some((state) => state.phase === "terminal"));
    assert.ok(parsedStates.some((state) => state.status === "released"));
    await assertNoSensitiveOutput(fixture, result);
  } finally {
    await disposeFixture(fixture);
  }
});

test("keeps parallel fixture roots, ports, claims, and cleanup ownership isolated", async () => {
  const [firstFixture, secondFixture] = await Promise.all([
    createFixture({ runWindowMs: 5_000 }),
    createFixture({ runWindowMs: 5_000 }),
  ]);
  try {
    assert.notEqual(firstFixture.root, secondFixture.root);
    assert.notEqual(firstFixture.port, secondFixture.port);

    const first = firstFixture.spawnCli();
    const second = secondFixture.spawnCli();
    await Promise.all([
      first.waitForPhase("running"),
      second.waitForPhase("running"),
    ]);

    first.child.kill("SIGINT");
    const firstResult = await first.result;
    assertTerminalProcess(firstResult, 130, "cancelled");
    assert.equal(second.child.exitCode, null);
    assert.ok((await secondFixture.controllerFiles()).length > 0);
    await assertNoSensitiveOutput(firstFixture, firstResult);
    assert.ok(!firstResult.stdout.includes(secondFixture.root));
    assert.ok(!firstResult.stderr.includes(secondFixture.root));

    second.child.kill("SIGINT");
    const secondResult = await second.result;
    assertTerminalProcess(secondResult, 130, "cancelled");
    await assertNoSensitiveOutput(secondFixture, secondResult);
    assert.ok(!secondResult.stdout.includes(firstFixture.root));
    assert.ok(!secondResult.stderr.includes(firstFixture.root));
  } finally {
    await Promise.all([
      disposeFixture(firstFixture),
      disposeFixture(secondFixture),
    ]);
  }
});
