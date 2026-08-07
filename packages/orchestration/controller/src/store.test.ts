import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ControllerStore,
  DuplicateWorkError,
  type ProcessIdentityProbe,
  createControllerStore,
} from "./index.js";

const timestamp = "2026-08-07T00:00:00.000Z";

const provider = (
  kind: "work" | "harness" | "infrastructure" | "scm" | "validation",
) => ({
  kind,
  id: `${kind}-provider`,
  version: "1",
  capabilities: [],
});

const createPlan = (workUri = "work://example/item") => ({
  schemaVersion: 1 as const,
  work: {
    uri: workUri,
    snapshot: {
      revision: "revision-1",
      provenance: { source: "fixture", revision: "source-1" },
    },
  },
  providers: {
    work: provider("work"),
    harness: provider("harness"),
    infrastructure: provider("infrastructure"),
    scm: provider("scm"),
    validation: provider("validation"),
  },
  validationChecks: [{ name: "check", command: "true", timeoutMs: 1_000 }],
  requiredCapabilities: {
    work: [],
    harness: [],
    infrastructure: [],
    scm: [],
    validation: [],
  },
  createdAt: timestamp,
  inputProvenance: { source: "input", revision: "input-1" },
});

const terminalResult = (plan: ReturnType<typeof createPlan>) => ({
  provenance: {
    schemaVersion: 1 as const,
    workUri: plan.work.uri,
    workRevision: plan.work.snapshot.revision,
    workSource: plan.work.snapshot.provenance.source,
    workSourceRevision: plan.work.snapshot.provenance.revision,
    inputSource: plan.inputProvenance.source,
    inputRevision: plan.inputProvenance.revision,
    planCreatedAt: plan.createdAt,
  },
  completedPhases: ["preflight", "running", "cleanup", "terminal"] as const,
  cleanup: { outcomes: [] },
  outcome: "succeeded" as const,
  failure: null,
});

const createClock = () => {
  let current = new Date(timestamp);
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
};

const createProbe = (
  liveness: "alive" | "dead" | "unknown" = "alive",
  pid = Math.floor(Math.random() * 10_000) + 1,
): ProcessIdentityProbe => ({
  current: () => ({ pid, startTime: `start-${pid}` }),
  probe: () => liveness,
});

const createStore = (
  stateRoot: string,
  options: Partial<Parameters<typeof createControllerStore>[0]> = {},
): ControllerStore =>
  createControllerStore({
    stateRoot,
    staleAfterMs: 60_000,
    controllerId: `controller-${randomUUID()}`,
    ...options,
  });

const withRoot = async (
  callback: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "reef-controller-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const expectControllerCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ code });
};

const childClaimSource = `
import { createControllerStore } from "./src/index.js";

const root = process.argv[1];
const runId = process.argv[2];
const workUri = process.argv[3];
const mode = process.argv[4];
const provider = (kind) => ({ kind, id: kind + "-provider", version: "1", capabilities: [] });
const plan = {
  schemaVersion: 1,
  work: { uri: workUri, snapshot: { revision: "revision-1", provenance: { source: "child", revision: "source-1" } } },
  providers: {
    work: provider("work"),
    harness: provider("harness"),
    infrastructure: provider("infrastructure"),
    scm: provider("scm"),
    validation: provider("validation"),
  },
  validationChecks: [{ name: "check", command: "true", timeoutMs: 1000 }],
  requiredCapabilities: { work: [], harness: [], infrastructure: [], scm: [], validation: [] },
  createdAt: "2026-08-07T00:00:00.000Z",
  inputProvenance: { source: "child-input", revision: "input-1" },
};
const store = createControllerStore({
  stateRoot: root,
  staleAfterMs: 60000,
  controllerId: "child-" + process.pid,
  processIdentity: {
    current: () => ({ pid: process.pid, startTime: "child-start" }),
    probe: () => "alive",
  },
});
try {
  await store.claim({ runId, plan });
  process.stdout.write(JSON.stringify({ ok: true, pid: process.pid }) + "\\n");
  if (mode === "hold") await new Promise(() => undefined);
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? "unknown" }) + "\\n");
  process.exitCode = 1;
}
`;

const spawnChildClaim = (
  root: string,
  runId: string,
  workUri: string,
  mode = "exit",
) => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      childClaimSource,
      root,
      runId,
      workUri,
      mode,
    ],
    {
      cwd: new URL("..", import.meta.url),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return child;
};

const collectChildOutput = (child: ReturnType<typeof spawn>): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(output));
  });

const waitForChildClaim = (
  child: ReturnType<typeof spawn>,
): Promise<{ ok: boolean; pid: number }> =>
  new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const line = output.split("\n")[0];
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as { ok?: boolean; pid?: number };
        if (parsed.ok === true && typeof parsed.pid === "number") {
          child.stdout?.off("data", onData);
          resolve({ ok: true, pid: parsed.pid });
        }
      } catch {
        // Wait until the complete JSON line is available.
      }
    };
    child.stdout?.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== null && code !== 0) reject(new Error(output));
    });
  });

describe("controller state store", () => {
  it("claims a strict prepared state and rejects invalid plans without writing", async () => {
    await withRoot(async (root) => {
      const store = createStore(root, { processIdentity: createProbe() });
      const plan = createPlan();
      const state = await store.claim({ runId: "run-one", plan });

      expect(state.phase).toBe("prepared");
      expect(state.revision).toBe(0);
      expect(state.plan.work.uri).toBe(plan.work.uri);
      expect(state.workspace).toBeNull();
      expect(state.artifacts).toEqual([]);
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.plan)).toBe(true);

      await expectControllerCode(
        store.claim({
          runId: "bad-plan",
          plan: { ...plan, extra: true } as never,
        }),
        "invalid_run_plan",
      );
      await expectControllerCode(
        store.claim({
          runId: "unsupported-plan",
          plan: { ...plan, schemaVersion: 2 } as never,
        }),
        "unsupported_schema_version",
      );

      const inspection = await store.inspect(plan.work.uri);
      expect(inspection.classification).toBe("active");
      expect(inspection.allowedActions).toEqual(["update"]);
    });
  });

  it("allows exactly one concurrent claim while independent work remains available", async () => {
    await withRoot(async (root) => {
      const plan = createPlan();
      const first = createStore(root, {
        processIdentity: createProbe("alive", 101),
      });
      const second = createStore(root, {
        processIdentity: createProbe("alive", 102),
      });
      const results = await Promise.allSettled([
        first.claim({ runId: "run-a", plan }),
        second.claim({ runId: "run-b", plan }),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason =
        rejected[0].status === "rejected" ? rejected[0].reason : null;
      expect(reason).toBeInstanceOf(DuplicateWorkError);
      expect(reason.existingRun.workUri).toBe(plan.work.uri);

      const otherPlan = createPlan("work://example/other");
      const other = await second.claim({ runId: "run-c", plan: otherPlan });
      expect(other.plan.work.uri).toBe(otherPlan.work.uri);
    });
  });

  it("keeps atomic revisions, deterministic references, terminal results, and cleanup retry", async () => {
    await withRoot(async (root) => {
      const clock = createClock();
      const plan = createPlan();
      const store = createStore(root, {
        clock: clock.now,
        processIdentity: createProbe(),
      });
      await store.claim({ runId: "run-lifecycle", plan });
      const differentOwnerStore = createStore(root, {
        processIdentity: createProbe("alive", 999),
      });
      await expectControllerCode(
        differentOwnerStore.update({
          runId: "run-lifecycle",
          operation: { type: "phase", phase: "preflight" },
        }),
        "ownership_lost",
      );
      const afterPhase = await store.update({
        runId: "run-lifecycle",
        operation: { type: "phase", phase: "preflight" },
      });
      expect(afterPhase.revision).toBe(1);
      const reference = {
        name: "workspace-ref",
        revision: "revision-1",
        uri: "workspace://example/ref",
      };
      const afterWorkspace = await store.update({
        runId: "run-lifecycle",
        operation: { type: "workspace", reference },
      });
      const afterArtifact = await store.update({
        runId: "run-lifecycle",
        operation: {
          type: "artifact",
          artifact: {
            kind: "commit",
            ref: "commit-1",
            uri: "artifact://example/commit-1",
          },
        },
      });
      const duplicateArtifact = await store.update({
        runId: "run-lifecycle",
        operation: {
          type: "artifact",
          artifact: {
            kind: "commit",
            ref: "commit-1",
            uri: "artifact://example/commit-1",
          },
        },
      });
      expect(afterWorkspace.revision).toBe(2);
      expect(afterArtifact.revision).toBe(3);
      expect(duplicateArtifact.revision).toBe(3);
      expect(afterArtifact.artifacts).toHaveLength(1);

      const terminal = await store.update({
        runId: "run-lifecycle",
        operation: { type: "terminal", result: terminalResult(plan) },
      });
      expect(terminal.phase).toBe("terminal");
      expect(terminal.terminalResult?.outcome).toBe("succeeded");
      expect(terminal.revision).toBe(4);
      expect((await store.inspect(plan.work.uri)).classification).toBe(
        "terminal",
      );
      await expectControllerCode(
        store.update({
          runId: "run-lifecycle",
          operation: { type: "phase", phase: "cleanup" },
        }),
        "terminal_mutation_rejected",
      );

      let callbackCalls = 0;
      await expectControllerCode(
        store.cleanup(plan.work.uri, async () => {
          callbackCalls += 1;
          throw new Error("opaque cleanup failure");
        }),
        "cleanup_failed",
      );
      expect(callbackCalls).toBe(1);
      expect((await store.inspect(plan.work.uri)).classification).toBe(
        "terminal",
      );
      await store.cleanup(plan.work.uri, async (workspace, signal) => {
        callbackCalls += 1;
        expect(workspace).toEqual(reference);
        expect(signal.aborted).toBe(false);
      });
      await expectControllerCode(store.inspect(plan.work.uri), "run_not_found");
      clock.advance(1_000);
      const rerun = await store.claim({ runId: "run-rerun", plan });
      expect(rerun.phase).toBe("prepared");
    });
  });

  it("keeps failed writes and concurrent readers on complete snapshots", async () => {
    await withRoot(async (root) => {
      const plan = createPlan("work://example/atomic");
      const store = createStore(root, { processIdentity: createProbe() });
      await store.claim({ runId: "run-atomic", plan });

      if (process.platform !== "win32") {
        await chmod(join(root, "records"), 0o500);
        await expectControllerCode(
          store.update({
            runId: "run-atomic",
            operation: { type: "phase", phase: "preflight" },
          }),
          "filesystem_permission",
        );
        await chmod(join(root, "records"), 0o700);
      }
      expect((await store.inspect(plan.work.uri)).state.revision).toBe(0);

      const observations: string[] = [];
      const reader = async (): Promise<void> => {
        let previousRevision = -1;
        for (let index = 0; index < 80; index += 1) {
          try {
            const inspection = await store.inspect(plan.work.uri);
            const { state } = inspection;
            if (state.revision < previousRevision) {
              observations.push("revision_rollback");
            }
            if (state.phase === "terminal" && state.terminalResult === null) {
              observations.push("terminal_without_result");
            }
            if (state.phase !== "terminal" && state.terminalResult !== null) {
              observations.push("non_terminal_with_result");
            }
            previousRevision = state.revision;
          } catch (error) {
            observations.push(error instanceof Error ? error.message : "read");
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      };

      const writer = async (): Promise<void> => {
        for (const phase of ["preflight", "running", "cleanup"] as const) {
          await store.update({
            runId: "run-atomic",
            operation: { type: "phase", phase },
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await store.update({
          runId: "run-atomic",
          operation: { type: "terminal", result: terminalResult(plan) },
        });
      };

      await Promise.all([reader(), reader(), writer()]);
      expect(observations).toEqual([]);
      const terminal = await store.inspect(plan.work.uri);
      expect(terminal.classification).toBe("terminal");
      expect(terminal.state.terminalResult).not.toBeNull();
    });
  });

  it("classifies live, unknown, recent-dead, and expired-dead owners safely", async () => {
    await withRoot(async (root) => {
      const clock = createClock();
      const plan = createPlan();
      const liveStore = createStore(root, {
        processIdentity: createProbe("alive", 201),
      });
      await liveStore.claim({ runId: "run-live", plan });
      expect((await liveStore.inspect(plan.work.uri)).classification).toBe(
        "active",
      );
      await expectControllerCode(
        liveStore.cleanup(plan.work.uri),
        "cleanup_not_allowed",
      );

      const unknownRoot = join(root, "unknown");
      const unknownPlan = createPlan("work://example/unknown");
      const unknownStore = createStore(unknownRoot, {
        processIdentity: createProbe("unknown", 202),
      });
      await unknownStore.claim({ runId: "run-unknown", plan: unknownPlan });
      const unknownInspection = await unknownStore.inspect(
        unknownPlan.work.uri,
      );
      expect(unknownInspection.classification).toBe("active");
      expect(unknownInspection.allowedActions).toEqual([]);
      await expectControllerCode(
        unknownStore.cleanup(unknownPlan.work.uri),
        "cleanup_not_allowed",
      );

      const recentRoot = join(root, "recent");
      const recentPlan = createPlan("work://example/recent");
      const recentStore = createStore(recentRoot, {
        processIdentity: createProbe("dead", 203),
        clock: clock.now,
      });
      await recentStore.claim({ runId: "run-recent", plan: recentPlan });
      expect(
        (await recentStore.inspect(recentPlan.work.uri)).classification,
      ).toBe("interrupted");
      await recentStore.cleanup(recentPlan.work.uri);

      const staleRoot = join(root, "stale");
      const stalePlan = createPlan("work://example/stale");
      const staleStore = createStore(staleRoot, {
        processIdentity: createProbe("dead", 204),
        clock: clock.now,
        staleAfterMs: 10,
      });
      await staleStore.claim({ runId: "run-stale", plan: stalePlan });
      clock.advance(11);
      expect(
        (await staleStore.inspect(stalePlan.work.uri)).classification,
      ).toBe("stale");
      await staleStore.cleanup(stalePlan.work.uri);
    });
  });

  it("records explicit interruption before cleanup and preserves the claim on failure", async () => {
    await withRoot(async (root) => {
      const plan = createPlan();
      const store = createStore(root, { processIdentity: createProbe() });
      await store.claim({ runId: "run-interrupted", plan });
      await store.update({
        runId: "run-interrupted",
        operation: {
          type: "workspace",
          reference: {
            name: "workspace-ref",
            revision: "revision-1",
            uri: "workspace://example/ref",
          },
        },
      });
      await store.update({
        runId: "run-interrupted",
        operation: { type: "interrupted" },
      });
      const inspection = await store.inspect(plan.work.uri);
      expect(inspection.classification).toBe("interrupted");
      expect(inspection.state.interruptedAt).not.toBeNull();
      await expectControllerCode(
        store.cleanup(plan.work.uri, async () => {
          throw new Error("cleanup failed");
        }),
        "cleanup_failed",
      );
      expect((await store.inspect(plan.work.uri)).classification).toBe(
        "interrupted",
      );
      await store.cleanup(plan.work.uri, async () => undefined);
    });
  });

  it("fails closed for secrets, malformed records, unsupported versions, and symlinks", async () => {
    await withRoot(async (root) => {
      const secretRoot = join(root, "secret");
      const secretStore = createStore(secretRoot, {
        redactionValues: ["canary-value"],
        processIdentity: createProbe(),
      });
      const secretPlan = createPlan("work://example/canary-value");
      await expectControllerCode(
        secretStore.claim({ runId: "run-secret", plan: secretPlan }),
        "secret_material_detected",
      );
      await expect(readdir(secretRoot)).rejects.toThrow();

      const malformedRoot = join(root, "malformed");
      const malformedStore = createStore(malformedRoot, {
        processIdentity: createProbe(),
      });
      const malformedPlan = createPlan("work://example/malformed");
      await malformedStore.claim({
        runId: "run-malformed",
        plan: malformedPlan,
      });
      await writeFile(
        join(malformedRoot, "records", "run-malformed.json"),
        "{}\n",
      );
      await expectControllerCode(
        malformedStore.inspect(malformedPlan.work.uri),
        "state_schema_invalid",
      );
      await expectControllerCode(
        malformedStore.cleanup(malformedPlan.work.uri),
        "state_schema_invalid",
      );

      const mismatchRoot = join(root, "mismatch");
      const mismatchStore = createStore(mismatchRoot, {
        processIdentity: createProbe(),
      });
      const mismatchPlan = createPlan("work://example/mismatch");
      await mismatchStore.claim({ runId: "run-mismatch", plan: mismatchPlan });
      const mismatchRecordPath = join(
        mismatchRoot,
        "records",
        "run-mismatch.json",
      );
      const mismatchClaimPath = join(
        mismatchRoot,
        "claims",
        (await readdir(join(mismatchRoot, "claims")))[0],
      );
      const originalRecord = await readFile(mismatchRecordPath, "utf8");
      const originalClaim = await readFile(mismatchClaimPath, "utf8");
      const recordValue = JSON.parse(originalRecord) as Record<string, unknown>;
      await writeFile(
        mismatchRecordPath,
        `${JSON.stringify({ ...recordValue, schemaVersion: 99 })}\n`,
      );
      await expectControllerCode(
        mismatchStore.inspect(mismatchPlan.work.uri),
        "unsupported_schema_version",
      );
      expect(await readFile(mismatchRecordPath, "utf8")).toContain(
        '"schemaVersion":99',
      );
      await writeFile(mismatchRecordPath, originalRecord);
      const claimValue = JSON.parse(originalClaim) as Record<string, unknown>;
      await writeFile(
        mismatchClaimPath,
        `${JSON.stringify({ ...claimValue, workUri: "work://example/other" })}\n`,
      );
      await expectControllerCode(
        mismatchStore.inspect(mismatchPlan.work.uri),
        "claim_record_mismatch",
      );
      expect(await readFile(mismatchClaimPath, "utf8")).toContain(
        "work://example/other",
      );
      await writeFile(mismatchClaimPath, originalClaim);

      const referenceSecretRoot = join(root, "reference-secret");
      const referenceSecretStore = createStore(referenceSecretRoot, {
        redactionValues: ["canary-value"],
        processIdentity: createProbe(),
      });
      const referenceSecretPlan = createPlan("work://example/reference");
      await referenceSecretStore.claim({
        runId: "run-reference-secret",
        plan: referenceSecretPlan,
      });
      await expectControllerCode(
        referenceSecretStore.update({
          runId: "run-reference-secret",
          operation: {
            type: "workspace",
            reference: {
              name: "workspace-ref",
              revision: "canary-value",
            },
          },
        }),
        "secret_material_detected",
      );
      await expectControllerCode(
        referenceSecretStore.update({
          runId: "run-reference-secret",
          operation: {
            type: "artifact",
            artifact: {
              kind: "proof",
              ref: "proof-1",
              title: "canary-value",
            },
          },
        }),
        "secret_material_detected",
      );
      expect(
        (await referenceSecretStore.inspect(referenceSecretPlan.work.uri)).state
          .revision,
      ).toBe(0);
      expect(
        (await readdir(join(referenceSecretRoot, "records"))).filter((name) =>
          name.endsWith(".tmp"),
        ),
      ).toEqual([]);

      const symlinkRoot = join(root, "symlink");
      const symlinkStore = createStore(symlinkRoot, {
        processIdentity: createProbe(),
      });
      const symlinkPlan = createPlan("work://example/symlink");
      await symlinkStore.claim({ runId: "run-symlink", plan: symlinkPlan });
      const target = join(symlinkRoot, "records", "run-symlink.json");
      const moved = join(symlinkRoot, "records", "run-symlink-copy.json");
      const record = await readFile(target, "utf8");
      await rm(target);
      await writeFile(moved, record, { mode: 0o600 });
      await symlink(moved, target);
      let callbackCalls = 0;
      await expectControllerCode(
        symlinkStore.cleanup(symlinkPlan.work.uri, async () => {
          callbackCalls += 1;
        }),
        "filesystem_symlink",
      );
      expect(callbackCalls).toBe(0);
    });
  });

  it("proves independent-process claim races and abrupt-owner cleanup on a real root", async () => {
    await withRoot(async (root) => {
      const workUri = "work://example/process-race";
      const children = [
        spawnChildClaim(root, "process-a", workUri),
        spawnChildClaim(root, "process-b", workUri),
      ];
      const outputs = await Promise.all(children.map(collectChildOutput));
      const parsed = outputs.map((output) => {
        const jsonLine = output.split("\n").find((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });
        if (!jsonLine) throw new Error(output);
        return JSON.parse(jsonLine) as { ok: boolean; code?: string };
      });
      expect(parsed.filter((result) => result.ok)).toHaveLength(1);
      expect(
        parsed.filter((result) => result.code === "duplicate_work"),
      ).toHaveLength(1);

      const parentStore = createStore(root, {
        processIdentity: {
          current: () => ({ pid: 999, startTime: "parent" }),
          probe: () => "dead",
        },
      });
      await parentStore.cleanup(workUri);

      const heldUri = "work://example/abrupt-owner";
      const heldChild = spawnChildClaim(root, "process-held", heldUri, "hold");
      const claimed = await waitForChildClaim(heldChild);
      expect(claimed.ok).toBe(true);
      heldChild.kill("SIGKILL");
      await new Promise<void>((resolve) =>
        heldChild.once("close", () => resolve()),
      );

      const interruptedStore = createStore(root, {
        processIdentity: {
          current: () => ({ pid: 999, startTime: "parent" }),
          probe: (identity) =>
            identity.pid === claimed.pid ? "dead" : "unknown",
        },
      });
      expect((await interruptedStore.inspect(heldUri)).classification).toBe(
        "interrupted",
      );
      await interruptedStore.cleanup(heldUri);
      expect(await readdir(join(root, "records"))).toEqual([]);
      expect(await readdir(join(root, "claims"))).toEqual([]);
    });
  });
});
