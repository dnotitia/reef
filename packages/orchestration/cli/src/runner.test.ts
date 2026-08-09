import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CliConfig,
  TerminalResultSchema,
  runCliInvocation,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function issueRow() {
  return {
    document_uri: "akb://reef-test/coll/issues/doc/reef-101.md",
    reef_id: "REEF-101",
    title: "Fixture work",
    status: "todo",
    issue_type: "task",
    priority: "high",
    assigned_to: "alice",
    requester: "alice",
    reporter: "alice",
    start_date: null,
    due_date: null,
    milestone_id: null,
    sprint_id: null,
    release_id: null,
    estimate_points: null,
    severity: null,
    rank: null,
    closed_at: null,
    closed_reason: null,
    parent_id: null,
    labels: [],
    depends_on: [],
    related_to: [],
    blocks: [],
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    meta: {
      author: "alice",
      last_editor: "alice",
      source: "test",
      last_status_change: null,
      external_refs: null,
      implementation_refs: null,
      watchers: null,
      reviewers: null,
      qa_owner: null,
      custom_fields: null,
    },
  };
}

function configFor(directory: string, runWindowMs = 10): CliConfig {
  return {
    schema_version: 1,
    controller: {
      state_root: join(directory, "controller"),
      stale_after_ms: 60_000,
    },
    repository: {
      id: "fixture-repository",
      owner: "octo",
      name: "reef",
      root: directory,
      managed_work_root: join(directory, "work"),
      base_revision:
        "0000000000000000000000000000000000000000000000000000000000000000",
      remote: "origin",
      remote_url: "https://github.com/octo/reef",
      base_branch: "main",
      branch: "feat/fixture",
      branch_policy: { allowed_prefixes: ["feat/"] },
      permissions: { commit: false, push: false, pull_request: false },
    },
    delivery: { max_validation_attempts: 2 },
    validation_checks: [
      { name: "invocation", command: "true", timeout_ms: 1000 },
    ],
    providers: [
      {
        kind: "work",
        id: "reef",
        version: "1.0.0",
        environment: ["REEF_AKB_BASE_URL", "REEF_AKB_JWT"],
        required_capabilities: ["read"],
        options: {
          vault: "reef-test",
          base_url_env: "REEF_AKB_BASE_URL",
          jwt_env: "REEF_AKB_JWT",
        },
      },
      {
        kind: "harness",
        id: "codex",
        version: "0.1.0",
        environment: [],
        required_capabilities: [],
        options: { executable: "node" },
      },
      {
        kind: "infrastructure",
        id: "local",
        version: "0.1.0",
        environment: ["PATH"],
        required_capabilities: [],
        options: { target: "foreground" },
      },
      {
        kind: "scm",
        id: "github",
        version: "0.1.0",
        environment: [],
        required_capabilities: [],
        options: {},
      },
      {
        kind: "validation",
        id: "local-validation",
        version: "0.1.0",
        environment: ["PATH"],
        required_capabilities: [],
        options: {},
      },
    ],
  } as CliConfig;
}

async function setupFixture(runWindowMs = 10) {
  const directory = await mkdtemp(join(tmpdir(), "reef-cli-test-"));
  temporaryDirectories.push(directory);
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(configFor(directory, runWindowMs))}\n`,
  );
  const responses = [
    {
      uri: "akb://reef-test/coll/issues/doc/reef-101.md",
      vault: "reef-test",
      path: "issues/reef-101.md",
      title: "REEF-101",
      type: "task",
      status: "active",
      summary: "Fixture work",
      created_by: "alice",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      current_commit: "fixture-commit",
      tags: [],
      content: "Fixture work body",
      is_public: false,
      public_slug: null,
    },
    {
      kind: "table_query",
      columns: Object.keys(issueRow()),
      items: [issueRow()],
      total: 1,
    },
    {
      id: "user-alice",
      user_id: "user-alice",
      username: "alice",
      email: "alice@example.com",
      display_name: "Alice Example",
      is_admin: true,
    },
  ];
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      calls.push(url);
      const body = url.endsWith("/auth/me")
        ? responses[2]
        : url.endsWith("/sql")
          ? responses[1]
          : responses[0];
      if (!body) throw new Error("unexpected fixture request");
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return {
    configPath,
    directory,
    calls,
    environment: {
      REEF_AKB_BASE_URL: "http://fixture.invalid/akb",
      REEF_AKB_JWT: "secret-work-token-canary",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
    },
    executeDelivery: async (context: {
      signal: AbortSignal;
      plan: { work: { snapshot: { revision: string } } };
    }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, runWindowMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new DOMException("cancelled", "AbortError"));
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
      });
      return {
        artifacts: [],
        validatedRevision: context.plan.work.snapshot.revision,
      };
    },
  };
}

describe("foreground work URI runner", () => {
  it("reads a work snapshot, persists the engine terminal state, and keeps output safe", async () => {
    const fixture = await setupFixture();
    const progress: Array<{ phase: string }> = [];
    const result = await runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
        onEvent: (event) => {
          if ("phase" in event) progress.push({ phase: event.phase });
        },
      },
    );

    if ("help" in result) throw new Error("expected a run result");
    expect(result.exitCode).toBe(0);
    expect(TerminalResultSchema.parse(result.terminal)).toMatchObject({
      schema_version: 1,
      work_uri: "reef://reef-test/REEF-101",
      outcome: "succeeded",
      artifact_refs: [],
      next_actions: ["review_in_progress"],
    });
    expect(result.terminal.plan?.providers.work).toMatchObject({
      id: "reef",
      version: "1.0.0",
    });
    expect(progress.map((event) => event.phase)).toEqual([
      "preflight",
      "running",
      "cleanup",
      "terminal",
    ]);
    expect(JSON.stringify(result.terminal)).not.toContain(
      "secret-work-token-canary",
    );
    expect(fixture.calls.some((url) => url.endsWith("/auth/me"))).toBe(true);
  });

  it("keeps a foreground run alive until its terminal result is emitted", async () => {
    const fixture = await setupFixture();
    const progress: string[] = [];
    const probe = setTimeout(() => undefined, 0);
    clearTimeout(probe);
    const unref = vi.spyOn(Object.getPrototypeOf(probe), "unref");

    try {
      const result = await runCliInvocation(
        ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
        {
          environment: fixture.environment,
          executeDelivery: fixture.executeDelivery,
          onEvent: (event) => {
            if ("phase" in event) progress.push(event.phase);
          },
        },
      );

      if ("help" in result) throw new Error("expected a run result");
      expect(result.exitCode).toBe(0);
      expect(result.terminal.outcome).toBe("succeeded");
      expect(progress).toEqual(["preflight", "running", "cleanup", "terminal"]);
    } finally {
      unref.mockRestore();
    }

    expect(unref).not.toHaveBeenCalled();
  });

  it("maps an upstream work-read failure to the general failure exit code", async () => {
    const fixture = await setupFixture();
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "upstream_failure" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
      },
    );

    if ("help" in result) throw new Error("expected a run result");
    expect(result.exitCode).toBe(1);
    expect(result.terminal).toMatchObject({
      outcome: "failed",
      failure: { code: "work_read_failed", path: ["work_uri"] },
    });
  });

  it("cancels a genuinely running invocation and leaves a cancelled terminal result", async () => {
    const fixture = await setupFixture(5_000);
    const controller = new AbortController();
    let running: (() => void) | undefined;
    const runningSeen = new Promise<void>((resolve) => {
      running = resolve;
    });
    const invocation = runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
        signal: controller.signal,
        onEvent: (event) => {
          if ("phase" in event && event.phase === "running") running?.();
        },
      },
    );
    await runningSeen;
    controller.abort();
    const result = await invocation;

    if ("help" in result) throw new Error("expected a run result");
    expect(result.exitCode).toBe(130);
    expect(result.terminal.outcome).toBe("cancelled");
    expect(result.terminal.cleanup.outcomes).toEqual([]);
  });

  it("blocks a second active claim without reclaiming the first run", async () => {
    const fixture = await setupFixture(5_000);
    const controller = new AbortController();
    let running: (() => void) | undefined;
    const runningSeen = new Promise<void>((resolve) => {
      running = resolve;
    });
    const firstInvocation = runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
        signal: controller.signal,
        onEvent: (event) => {
          if ("phase" in event && event.phase === "running") running?.();
        },
      },
    );
    await runningSeen;

    const blocked = await runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
      },
    );
    if ("help" in blocked) throw new Error("expected a run result");
    expect(blocked.exitCode).toBe(3);
    expect(blocked.terminal).toMatchObject({
      outcome: "blocked",
      failure: { code: "duplicate_work", path: ["work_uri"] },
      controller: { existing_run: { work_uri: "reef://reef-test/REEF-101" } },
    });

    controller.abort();
    const first = await firstInvocation;
    if ("help" in first) throw new Error("expected a run result");
    expect(first.terminal.outcome).toBe("cancelled");
  });

  it("rejects invalid config before creating the controller root", async () => {
    const fixture = await setupFixture();
    const config = JSON.parse(
      await readFile(fixture.configPath, "utf8"),
    ) as Record<string, unknown>;
    config.delivery = undefined;
    await writeFile(fixture.configPath, JSON.stringify(config));

    const result = await runCliInvocation(
      ["run", "reef://reef-test/REEF-101", "--config", fixture.configPath],
      {
        environment: fixture.environment,
        executeDelivery: fixture.executeDelivery,
      },
    );
    if ("help" in result) throw new Error("expected a run result");
    expect(result.exitCode).toBe(2);
    expect(result.terminal.failure).toMatchObject({
      code: "config_invalid",
      path: ["delivery"],
    });
  });
});
