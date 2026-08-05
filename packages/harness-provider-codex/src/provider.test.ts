import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HarnessExecutionPolicy,
  HarnessObservationEvent,
  HarnessProvider,
  ProviderReference,
} from "@reef/orchestrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_HARNESS_PROVIDER_ID,
  CODEX_HARNESS_PROVIDER_VERSION,
  createCodexHarnessProvider,
} from "./index.js";
import { parseFinalOutput, parseJsonLine } from "./protocol.js";

const fakeServerSource = String.raw`#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "complete";
const logPath = process.env.FAKE_LOG;
let threadId = "thread-" + process.pid;
let turnNumber = 0;
let waitingFor = null;

const record = (value) => {
  if (logPath) appendFileSync(logPath, JSON.stringify(value) + "\n", "utf8");
};
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const threadParams = (id) => ({ threadId, turnId: id });
const finalItem = (id) => ({
  id: "item-" + id,
  type: "agentMessage",
  text: JSON.stringify({
    intent: "completed",
    summary: mode === "secret" ? "secret=top-secret" : "completed",
  }),
});
const completeTurn = (id) => {
  const item = finalItem(id);
  send({ method: "turn/started", params: { threadId, turn: { id } } });
  send({ method: "item/completed", params: { ...threadParams(id), item } });
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id, status: "completed", items: [item] },
    },
  });
};

record({ type: "argv", value: process.argv.slice(2) });
process.stderr.write("token=top-secret");

const readline = createInterface({ input: process.stdin });
readline.on("line", (line) => {
  const message = JSON.parse(line);
  record({ type: "input", value: message });

  if (message.method === "initialize") {
    if (mode === "handshake") return;
    send({ id: message.id, result: { userAgent: "fake", platformFamily: "fake" } });
    return;
  }
  if (message.method === "initialized") return;

  if (message.method === "thread/start" || message.method === "thread/resume") {
    if (message.method === "thread/resume") threadId = message.params.threadId;
    send({ id: message.id, result: { thread: { id: threadId } } });
    send({ method: "thread/started", params: { thread: { id: threadId } } });
    return;
  }

  if (message.method === "turn/start") {
    const turnId = "turn-" + ++turnNumber;
    send({ id: message.id, result: { turn: { id: turnId } } });
    if (mode === "malformed") {
      setTimeout(() => process.stdout.write("{not-json\n"), 10);
      return;
    }
    if (mode === "secret") {
      send({ method: "unknown/notification", params: { secret: "top-secret" } });
      send({
        method: "item/agentMessage/delta",
        params: { ...threadParams(turnId), itemId: "item-" + turnId, delta: "token=top-secret" },
      });
    }
    if (mode === "input") {
      waitingFor = { kind: "user_input", turnId };
      send({
        id: 90,
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId,
          itemId: "question-item",
          questions: [
            {
              id: "choice",
              header: "Choice",
              question: "Choose a safe option",
              options: [{ label: "yes", description: "Proceed" }],
              isOther: false,
              isSecret: false,
            },
          ],
          autoResolutionMs: null,
        },
      });
      return;
    }
    if (mode === "approval") {
      waitingFor = { kind: "approval", turnId };
      send({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId, itemId: "approval-item", reason: "approval required" },
      });
      return;
    }
    if (mode === "interrupt") {
      waitingFor = { kind: "interrupt", turnId };
      return;
    }
    completeTurn(turnId);
    return;
  }

  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    if (waitingFor) {
      send({
        method: "turn/completed",
        params: { threadId, turn: { id: waitingFor.turnId, status: "interrupted", items: [] } },
      });
      waitingFor = null;
    }
    return;
  }

  if (message.method === "turn/steer") {
    send({ id: message.id, result: { turn: { id: message.params.expectedTurnId } } });
    return;
  }

  if (message.id === 90 && message.result) {
    waitingFor = null;
    completeTurn("turn-" + turnNumber);
    return;
  }
  if (message.id === 91 && message.result) {
    waitingFor = null;
    completeTurn("turn-" + turnNumber);
  }
});
`;

interface Fixture {
  readonly root: string;
  readonly executable: string;
  readonly logPath: string;
}

interface RunningSession {
  readonly provider: HarnessProvider;
  readonly session: ProviderReference;
}

const runningSessions: RunningSession[] = [];
const fixtures: Fixture[] = [];

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const createFixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), "reef-harness-test-"));
  const executable = join(root, "fake-codex.mjs");
  const logPath = join(root, "messages.jsonl");
  await writeFile(executable, fakeServerSource, "utf8");
  await chmod(executable, 0o755);
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  await writeFile(join(root, ".git"), "gitdir: fixture\n", "utf8");
  const fixture = { root, executable, logPath };
  fixtures.push(fixture);
  return fixture;
};

const policyFor = (
  fixture: Fixture,
  mode: string,
  overrides: Partial<HarnessExecutionPolicy> = {},
): HarnessExecutionPolicy => ({
  sandboxMode: "read-only",
  writableRoots: [],
  networkAccess: false,
  approvalMode: "never",
  environment: {
    FAKE_MODE: mode,
    FAKE_LOG: fixture.logPath,
    PATH: process.env.PATH ?? "",
  },
  ...overrides,
});

const startInput = (
  fixture: Fixture,
  mode: string,
  overrides: Partial<HarnessExecutionPolicy> = {},
) => ({
  workUri: "reef://test/work",
  instruction: "Read the fixture and return a structured result.",
  repositoryCwd: fixture.root,
  executionPolicy: policyFor(fixture, mode, overrides),
});

const startProvider = async (
  fixture: Fixture,
  mode: string,
  overrides: Partial<HarnessExecutionPolicy> = {},
): Promise<RunningSession> => {
  const provider = createCodexHarnessProvider({
    executable: fixture.executable,
    handshakeTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
    shutdownTimeoutMs: 500,
    maxEvents: 32,
  });
  const result = await provider.start(startInput(fixture, mode, overrides), {});
  const running = { provider, session: result.session };
  runningSessions.push(running);
  return running;
};

const collectUntilTerminal = async (
  running: RunningSession,
  onEvent?: (event: HarnessObservationEvent) => Promise<void>,
) => {
  const events: HarnessObservationEvent[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const observation = await running.provider.observe(
      { session: running.session },
      {},
    );
    for (const event of observation.events) {
      events.push(event);
      await onEvent?.(event);
    }
    const terminal = events.find((event) => event.type === "terminal");
    if (terminal?.type === "terminal") return { events, terminal };
    await delay(5);
  }
  throw new Error("fake_server_terminal_timeout");
};

afterEach(async () => {
  for (const running of runningSessions.splice(0)) {
    try {
      await running.provider.stop({ session: running.session }, {});
    } catch {
      // A failed start may already have stopped its process.
    }
  }
  for (const fixture of fixtures.splice(0)) {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

describe("Codex harness provider", () => {
  it("exports the concrete provider identity and parses only the public result", () => {
    expect(CODEX_HARNESS_PROVIDER_ID).toBe("codex");
    expect(CODEX_HARNESS_PROVIDER_VERSION).toBe("0.1.0");
    expect(
      parseFinalOutput(JSON.stringify({ intent: "completed", summary: "ok" })),
    ).toEqual({
      intent: "completed",
      summary: "ok",
    });
    expect(
      parseFinalOutput(
        JSON.stringify({ intent: "completed", summary: "ok", raw: "secret" }),
      ),
    ).toBeNull();
    expect(
      parseJsonLine(
        '{"method":"unknown/notification","params":{"secret":"hidden"}}',
      ),
    ).toEqual({
      type: "notification",
      method: "unknown/notification",
      params: { secret: "hidden" },
    });
  });

  it("runs the fixed app-server protocol, emits a terminal event, and redacts raw data", async () => {
    const fixture = await createFixture();
    const running = await startProvider(fixture, "secret");
    const result = await collectUntilTerminal(running);

    expect(result.terminal).toMatchObject({
      type: "terminal",
      outcome: "completed",
    });
    const observationText = JSON.stringify(result.events);
    expect(observationText).not.toContain("top-secret");
    const records = (await readFile(fixture.logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toEqual({
      type: "argv",
      value: ["app-server", "--listen", "stdio://"],
    });
    const startRequest = records.find(
      (record) =>
        record.type === "input" && record.value.method === "thread/start",
    );
    expect(startRequest.value.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const turnRequest = records.find(
      (record) =>
        record.type === "input" && record.value.method === "turn/start",
    );
    expect(turnRequest.value.params.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: false,
    });

    await expect(
      running.provider.stop({ session: running.session }, {}),
    ).resolves.toEqual({
      stopped: true,
    });
    await expect(
      running.provider.stop({ session: running.session }, {}),
    ).resolves.toEqual({
      stopped: true,
    });
  });

  it("matches user-input requests exactly and never writes stale answers upstream", async () => {
    const fixture = await createFixture();
    const running = await startProvider(fixture, "input");
    let answered = false;
    const result = await collectUntilTerminal(running, async (event) => {
      if (event.type !== "user_input_request" || answered) return;
      const before = (await readFile(fixture.logPath, "utf8"))
        .trim()
        .split("\n").length;
      await expect(
        running.provider.sendInput(
          {
            session: running.session,
            input: {
              type: "user_input",
              requestId: "stale",
              answers: { choice: ["yes"] },
            },
          },
          {},
        ),
      ).rejects.toMatchObject({ code: "request" });
      const after = (await readFile(fixture.logPath, "utf8"))
        .trim()
        .split("\n").length;
      expect(after).toBe(before);
      await running.provider.sendInput(
        {
          session: running.session,
          input: {
            type: "user_input",
            requestId: event.requestId,
            answers: { choice: ["yes"] },
          },
        },
        {},
      );
      answered = true;
    });
    expect(result.terminal).toMatchObject({ outcome: "completed" });
  });

  it("surfaces approvals as blocked events and sends only an explicit decision", async () => {
    const fixture = await createFixture();
    const running = await startProvider(fixture, "approval");
    let decided = false;
    const result = await collectUntilTerminal(running, async (event) => {
      if (event.type !== "approval_blocked" || decided) return;
      expect(event.approval).toBe("command");
      await running.provider.sendInput(
        {
          session: running.session,
          input: {
            type: "approval",
            requestId: event.requestId,
            decision: "decline",
          },
        },
        {},
      );
      decided = true;
    });
    expect(result.terminal).toMatchObject({ outcome: "completed" });
    const records = (await readFile(fixture.logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      records.some((record) => record.value?.result?.decision === "decline"),
    ).toBe(true);
  });

  it("makes malformed transport terminal and secret-free failures observable", async () => {
    const fixture = await createFixture();
    const running = await startProvider(fixture, "malformed");
    const result = await collectUntilTerminal(running);

    expect(result.terminal).toMatchObject({
      type: "terminal",
      outcome: "failed",
      error: {
        code: "protocol",
        providerKind: "harness",
        providerId: "codex",
      },
    });
    expect(JSON.stringify(result.events)).not.toContain("top-secret");
  });

  it("distinguishes pre-start and mid-handshake cancellation", async () => {
    const fixture = await createFixture();
    const provider = createCodexHarnessProvider({
      executable: fixture.executable,
    });
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      provider.start(startInput(fixture, "complete"), {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });

    const handshake = new AbortController();
    const startPromise = provider.start(startInput(fixture, "handshake"), {
      signal: handshake.signal,
    });
    await delay(25);
    handshake.abort();
    await expect(startPromise).rejects.toMatchObject({ code: "cancelled" });
  });

  it("validates policy combinations and maps explicit sandbox modes", async () => {
    const fixture = await createFixture();
    const provider = createCodexHarnessProvider({
      executable: fixture.executable,
    });
    const outside = await mkdtemp(join(tmpdir(), "reef-harness-outside-"));
    try {
      const danger = await provider.start(
        startInput(fixture, "complete", {
          sandboxMode: "danger-full-access",
        }),
        {},
      );
      const dangerRecords = (await readFile(fixture.logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const dangerTurn = dangerRecords.find(
        (record) =>
          record.type === "input" && record.value.method === "turn/start",
      );
      expect(dangerTurn.value.params.sandboxPolicy).toEqual({
        type: "dangerFullAccess",
      });
      await provider.stop({ session: danger.session }, {});
      await expect(
        provider.start(
          startInput(fixture, "complete", {
            sandboxMode: "workspace-write",
            writableRoots: [outside],
          }),
          {},
        ),
      ).rejects.toMatchObject({ code: "configuration" });
      await expect(
        provider.start(
          startInput(fixture, "complete", {
            environment: { "NOT-AN-ENVIRONMENT-KEY": "value" },
          }),
          {},
        ),
      ).rejects.toMatchObject({ code: "configuration" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps sessions isolated and interrupts an active turn before bounded cleanup", async () => {
    const fixture = await createFixture();
    const first = await startProvider(fixture, "interrupt");
    const second = await startProvider(fixture, "complete");
    expect(first.session.name).not.toBe(second.session.name);

    await expect(
      first.provider.interrupt({ session: first.session }, {}),
    ).resolves.toEqual({
      interrupted: true,
    });
    const firstResult = await collectUntilTerminal(first);
    expect(firstResult.terminal).toMatchObject({ outcome: "interrupted" });
    const secondResult = await collectUntilTerminal(second);
    expect(secondResult.terminal).toMatchObject({ outcome: "completed" });
    await expect(
      first.provider.stop({ session: first.session }, {}),
    ).resolves.toEqual({
      stopped: true,
    });
    await expect(
      second.provider.stop({ session: second.session }, {}),
    ).resolves.toEqual({
      stopped: true,
    });
  });

  it("resumes an opaque thread reference on a new connection", async () => {
    const fixture = await createFixture();
    const running = await startProvider(fixture, "complete");
    await collectUntilTerminal(running);
    const oldReference = running.session;
    await running.provider.stop({ session: oldReference }, {});

    const resumed = await running.provider.resume(
      {
        session: oldReference,
        repositoryCwd: fixture.root,
        executionPolicy: policyFor(fixture, "complete"),
      },
      {},
    );
    runningSessions.push({
      provider: running.provider,
      session: resumed.session,
    });
    expect(resumed.session.name).toBe(oldReference.name);
    expect(resumed.session.revision).toBe("2");
    await running.provider.sendInput(
      {
        session: resumed.session,
        input: { type: "text", text: "Continue with the fixture." },
      },
      {},
    );
    const result = await collectUntilTerminal({
      provider: running.provider,
      session: resumed.session,
    });
    expect(result.terminal).toMatchObject({ outcome: "completed" });
  });
});
