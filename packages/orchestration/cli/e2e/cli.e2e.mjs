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
  assert.ok(!output.includes(fixture.root), "private fixture root leaked");
  for (const value of sensitiveValues(fixture)) {
    assert.ok(!output.includes(value), "fixture credential leaked");
  }
  for (const file of await fixture.controllerFiles()) {
    assert.ok(!file.content.includes(fixture.root), "private path leaked");
    for (const value of sensitiveValues(fixture)) {
      assert.ok(!file.content.includes(value), "credential leaked");
    }
  }
};

const assertPhaseStream = (
  result,
  expected = ["preflight", "running", "cleanup", "terminal"],
) => {
  const phaseEvents = result.events.filter(
    (event) => event.event === "execution.phase",
  );
  assert.deepEqual(
    phaseEvents.map((event) => event.phase),
    expected,
  );
  for (const line of result.stderr.trim().split("\n")) {
    if (line.trim()) assert.doesNotThrow(() => JSON.parse(line));
  }
};

const disposeFixture = async (fixture) => {
  await fixture.dispose();
  assert.equal(await pathExists(fixture.root), false);
  await assert.rejects(fetch(`${fixture.baseUrl}/api/v1/auth/me`));
};

test("hands off a successful exact head through branch, proof, draft PR, and Reef review", async () => {
  const fixture = await createFixture({ scenario: "success" });
  try {
    const result = await fixture.spawnCli().result;

    assertTerminalProcess(result, 0, "succeeded");
    assertPhaseStream(result);
    const artifacts = result.terminal.artifact_refs;
    assert.deepEqual(
      artifacts.map(({ kind }) => kind),
      ["branch", "commit", "proof", "pull_request"],
    );
    const commit = artifacts.find(({ kind }) => kind === "commit");
    const proof = artifacts.find(({ kind }) => kind === "proof");
    assert.ok(commit);
    assert.ok(proof);
    assert.equal(proof.ref, commit.ref);
    assert.equal(fixture.targetRow().status, "in_review");
    const meta = JSON.parse(fixture.targetRow().meta);
    assert.deepEqual(
      meta.implementation_refs.map(({ type, ref }) => ({ type, ref })),
      [
        { type: "branch", ref: fixture.branch },
        { type: "commit", ref: commit.ref },
        { type: "pull_request", ref: "1" },
      ],
    );
    assert.equal(fixture.pullRequests.length, 1);
    assert.equal(fixture.pullRequests[0].draft, true);
    assert.deepEqual(
      result.events
        .filter((event) => event.event === "execution.validation")
        .map(({ stage }) => stage),
      ["validation_attempt", "validation_passed"],
    );
    assert.ok(
      fixture.requests.some(({ path }) =>
        path.endsWith(
          `/documents/${"fixture-vault"}/issues/${fixture.targetId.toLowerCase()}.md`,
        ),
      ),
    );
    assert.ok(fixture.requests.some(({ path }) => path === "/api/v1/auth/me"));
    await assertNoSensitiveOutput(fixture, result);
  } finally {
    await disposeFixture(fixture);
  }
});

test("repairs the first failed local validation with a new exact candidate head", async () => {
  const fixture = await createFixture({ scenario: "repair" });
  try {
    const result = await fixture.spawnCli().result;

    assertTerminalProcess(result, 0, "succeeded");
    const commit = result.terminal.artifact_refs.find(
      ({ kind }) => kind === "commit",
    );
    const proof = result.terminal.artifact_refs.find(
      ({ kind }) => kind === "proof",
    );
    assert.ok(commit);
    assert.ok(proof);
    assert.equal(commit.ref, proof.ref);
    assert.notEqual(commit.ref, fixture.baseRevision);
    assert.equal(fixture.targetRow().status, "in_review");
    assert.equal(fixture.pullRequests.length, 1);
    const validationEvents = result.events.filter(
      (event) => event.event === "execution.validation",
    );
    assert.deepEqual(
      validationEvents.map(({ stage }) => stage),
      [
        "validation_attempt",
        "validation_failed",
        "validation_repair",
        "validation_attempt",
        "validation_passed",
      ],
    );
    const [firstAttempt, firstFailure, repair, secondAttempt, passed] =
      validationEvents;
    assert.equal(firstAttempt.attempt, 1);
    assert.equal(
      firstFailure.candidate_revision,
      firstAttempt.candidate_revision,
    );
    assert.equal(firstFailure.check.status, "failed");
    assert.equal(repair.attempt, 2);
    assert.equal(
      repair.previous_candidate_revision,
      firstAttempt.candidate_revision,
    );
    assert.equal(repair.candidate_revision, secondAttempt.candidate_revision);
    assert.notEqual(
      repair.candidate_revision,
      repair.previous_candidate_revision,
    );
    assert.equal(passed.candidate_revision, commit.ref);
    await assertNoSensitiveOutput(fixture, result);
  } finally {
    await disposeFixture(fixture);
  }
});

test("leaves a blocked user-input decision pending without PR or review handoff", async () => {
  const fixture = await createFixture({ scenario: "blocked" });
  try {
    const result = await fixture.spawnCli().result;

    assertTerminalProcess(result, 3, "blocked");
    assert.equal(result.terminal.failure.code, "blocked");
    assert.deepEqual(result.terminal.artifact_refs, []);
    assert.equal(fixture.targetRow().status, "in_progress");
    assert.equal(fixture.pullRequests.length, 0);
    assert.equal(
      JSON.parse(fixture.targetRow().meta).implementation_refs,
      null,
    );
    assert.equal(fixture.comments.length, 1);
    assert.match(fixture.comments[0].body, /^pending: Question:/u);
    assert.match(fixture.comments[0].body, /Choices:/u);
    assert.match(fixture.comments[0].body, /Recommendation:/u);
    await assertNoSensitiveOutput(fixture, result);
  } finally {
    await disposeFixture(fixture);
  }
});

test("returns stable config, provider-resolution, and upstream failures before claiming", async () => {
  const fixture = await createFixture({ scenario: "success" });
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

test("blocks a duplicate active claim and cancels the owner without delivery", async () => {
  const fixture = await createFixture({ scenario: "hold" });
  try {
    const first = fixture.spawnCli();
    await first.waitForPhase("running");

    const blocked = await fixture.spawnCli().result;
    assertTerminalProcess(blocked, 3, "blocked");
    assert.equal(blocked.terminal.failure.code, "duplicate_work");
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
