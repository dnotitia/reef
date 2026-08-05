import { describe, expect, it } from "vitest";
import {
  type ExecutionEvent,
  type ProviderRegistry,
  executeRunPlan,
} from "./engine.js";
import * as publicApi from "./index.js";
import {
  HARNESS_CAPABILITIES,
  type HarnessProvider,
  INFRASTRUCTURE_CAPABILITIES,
  type InfrastructureProvider,
  type ProviderCapability,
  type ProviderKind,
  SCM_CAPABILITIES,
  type ScmProvider,
  VALIDATION_CAPABILITIES,
  type ValidationProvider,
  WORK_CAPABILITIES,
  type WorkProvider,
} from "./provider.js";
import { type RunPlan, type RunPlanInput, parseRunPlan } from "./runPlan.js";

const providerSnapshot = (
  kind: ProviderKind,
  id: string,
  capabilities: readonly ProviderCapability[],
): RunPlanInput["providers"]["work"] => ({
  kind,
  id,
  version: "1.0.0",
  capabilities: [...capabilities],
});

const validInput = (): RunPlanInput => ({
  schemaVersion: 1,
  work: {
    uri: "akb://reef-test/coll/issues/doc/reef-442.md",
    snapshot: {
      revision: "work-revision",
      provenance: { source: "akb", revision: "source-revision" },
    },
  },
  providers: {
    work: providerSnapshot("work", "fake-work", WORK_CAPABILITIES),
    harness: providerSnapshot("harness", "fake-harness", HARNESS_CAPABILITIES),
    infrastructure: providerSnapshot(
      "infrastructure",
      "fake-infrastructure",
      INFRASTRUCTURE_CAPABILITIES,
    ),
    scm: providerSnapshot("scm", "fake-scm", SCM_CAPABILITIES),
    validation: providerSnapshot(
      "validation",
      "fake-validation",
      VALIDATION_CAPABILITIES,
    ),
  },
  requiredCapabilities: {
    work: ["read"],
    harness: ["start"],
    infrastructure: ["provision"],
    scm: ["readBase"],
    validation: ["validate"],
  },
  createdAt: "2026-08-05T02:00:00.000Z",
  inputProvenance: { source: "dispatch", revision: "input-revision" },
});

interface CallCounts {
  providerOperations: number;
  taskCalls: number;
}

const makeRegistry = (
  plan: RunPlan,
  counts: CallCounts = { providerOperations: 0, taskCalls: 0 },
): { readonly providers: ProviderRegistry; readonly counts: CallCounts } => {
  const providerCall = () => {
    counts.providerOperations += 1;
  };

  const work: WorkProvider = {
    kind: "work",
    id: plan.providers.work.id,
    version: plan.providers.work.version,
    capabilities: WORK_CAPABILITIES,
    read: ({ uri }) => {
      providerCall();
      return {
        uri,
        revision: "work-revision",
        provenance: { source: "fake-work", revision: "source-revision" },
      };
    },
    refresh: ({ uri }) => {
      providerCall();
      return {
        uri,
        revision: "work-revision",
        provenance: { source: "fake-work", revision: "source-revision" },
      };
    },
    transition: ({ uri }) => {
      providerCall();
      return {
        uri,
        revision: "work-revision",
        provenance: { source: "fake-work", revision: "source-revision" },
      };
    },
    report: (report) => {
      providerCall();
      return report;
    },
    linkArtifact: ({ artifact }) => {
      providerCall();
      return artifact;
    },
  };

  const harness: HarnessProvider = {
    kind: "harness",
    id: plan.providers.harness.id,
    version: plan.providers.harness.version,
    capabilities: HARNESS_CAPABILITIES,
    start: () => {
      providerCall();
      return { session: { name: "session", revision: "1" } };
    },
    observe: () => {
      providerCall();
      return { state: "ready" };
    },
    sendInput: () => {
      providerCall();
      return { accepted: true };
    },
    interrupt: () => {
      providerCall();
      return { interrupted: true };
    },
    resume: () => {
      providerCall();
      return { session: { name: "session", revision: "1" } };
    },
    stop: () => {
      providerCall();
      return { stopped: true };
    },
  };

  const infrastructure: InfrastructureProvider = {
    kind: "infrastructure",
    id: plan.providers.infrastructure.id,
    version: plan.providers.infrastructure.version,
    capabilities: INFRASTRUCTURE_CAPABILITIES,
    provision: () => {
      providerCall();
      return { resource: { name: "resource", revision: "1" } };
    },
    exec: () => {
      providerCall();
      return { exitCode: 0 };
    },
    sync: ({ resource, revision }) => {
      providerCall();
      return { resource, revision };
    },
    collect: () => {
      providerCall();
      return { artifacts: [] };
    },
    cleanup: () => {
      providerCall();
      return { cleaned: true };
    },
  };

  const scm: ScmProvider = {
    kind: "scm",
    id: plan.providers.scm.id,
    version: plan.providers.scm.version,
    capabilities: SCM_CAPABILITIES,
    readBase: () => {
      providerCall();
      return { name: "main", revision: "base" };
    },
    readRef: () => {
      providerCall();
      return { name: "ref", revision: "revision" };
    },
    createBranch: () => {
      providerCall();
      return { name: "branch", revision: "revision" };
    },
    commit: () => {
      providerCall();
      return { name: "commit", revision: "revision" };
    },
    push: () => {
      providerCall();
      return { name: "push", revision: "revision" };
    },
    createDraftPullRequest: () => {
      providerCall();
      return { kind: "pull_request", ref: "1" };
    },
    collectArtifact: () => {
      providerCall();
      return { kind: "file", ref: "artifact" };
    },
  };

  const validation: ValidationProvider = {
    kind: "validation",
    id: plan.providers.validation.id,
    version: plan.providers.validation.version,
    capabilities: VALIDATION_CAPABILITIES,
    validate: () => {
      providerCall();
      return { status: "passed", checks: [], artifacts: [] };
    },
  };

  return {
    providers: { work, harness, infrastructure, scm, validation },
    counts,
  };
};

const parsedPlan = (): RunPlan => parseRunPlan(validInput());
const fixedNow = () => new Date("2026-08-05T02:01:00.000Z");

describe("executeRunPlan", () => {
  it("exports the engine and runs a matched registry through the shared lifecycle", async () => {
    expect(publicApi.executeRunPlan).toBe(executeRunPlan);
    expect(publicApi.preflightProviderRegistry).toBeDefined();
    expect(publicApi.installShutdownHandlers).toBeDefined();

    const plan = parsedPlan();
    const { providers, counts } = makeRegistry(plan);
    const events: ExecutionEvent[] = [];
    const cleanupOrder: string[] = [];

    const result = await executeRunPlan(
      plan,
      providers,
      async (context) => {
        counts.taskCalls += 1;
        context.registerCleanup(() => {
          cleanupOrder.push("first");
        });
        context.registerCleanup(() => {
          cleanupOrder.push("second");
        });
        await expect(
          context.invoke("work", "read", { uri: plan.work.uri }),
        ).resolves.toMatchObject({ uri: plan.work.uri });
      },
      { onEvent: (event) => events.push(event), now: fixedNow },
    );

    expect(result.outcome).toBe("succeeded");
    expect(result.failure).toBeNull();
    expect(result.completedPhases).toEqual([
      "preflight",
      "running",
      "cleanup",
      "terminal",
    ]);
    expect(events.map((event) => event.phase)).toEqual(result.completedPhases);
    expect(counts.taskCalls).toBe(1);
    expect(counts.providerOperations).toBe(1);
    expect(cleanupOrder).toEqual(["second", "first"]);
    expect(result.provenance).toMatchObject({
      workUri: plan.work.uri,
      workRevision: "work-revision",
      inputRevision: "input-revision",
    });
  });

  it("accepts capability snapshots with different ordering but rejects every binding drift", async () => {
    const plan = parsedPlan();
    const { providers } = makeRegistry(plan);
    const reordered: ProviderRegistry = {
      ...providers,
      work: {
        ...providers.work,
        capabilities: [...providers.work.capabilities].reverse(),
      },
    };
    await expect(
      executeRunPlan(plan, reordered, () => undefined),
    ).resolves.toMatchObject({ outcome: "succeeded" });

    const cases: Array<{
      readonly code: string;
      readonly providerKind: ProviderKind;
      readonly providers: ProviderRegistry;
    }> = [
      {
        code: "provider_missing",
        providerKind: "validation",
        providers: (() => {
          const { validation, ...rest } = providers;
          void validation;
          return rest as ProviderRegistry;
        })(),
      },
      {
        code: "provider_kind_mismatch",
        providerKind: "work",
        providers: {
          ...providers,
          work: {
            ...providers.work,
            kind: "harness",
          } as unknown as WorkProvider,
        },
      },
      {
        code: "provider_id_mismatch",
        providerKind: "work",
        providers: {
          ...providers,
          work: { ...providers.work, id: "different-work" },
        },
      },
      {
        code: "provider_version_mismatch",
        providerKind: "work",
        providers: {
          ...providers,
          work: { ...providers.work, version: "2.0.0" },
        },
      },
      {
        code: "provider_capability_drift",
        providerKind: "work",
        providers: {
          ...providers,
          work: { ...providers.work, capabilities: ["read"] },
        },
      },
    ];

    for (const testCase of cases) {
      let taskCalls = 0;
      const result = await executeRunPlan(plan, testCase.providers, () => {
        taskCalls += 1;
      });
      expect(result.outcome).toBe("failed");
      expect(result.failure).toMatchObject({
        code: "preflight_failed",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: testCase.code,
            providerKind: testCase.providerKind,
          }),
        ]),
      });
      expect(taskCalls).toBe(0);
    }

    const requiredCapabilityPlan = {
      ...plan,
      requiredCapabilities: {
        ...plan.requiredCapabilities,
        work: ["not-declared"],
      },
    } as unknown as RunPlan;
    const requiredResult = await executeRunPlan(
      requiredCapabilityPlan,
      providers,
      () => undefined,
    );
    expect(requiredResult.failure).toMatchObject({
      code: "preflight_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported_capability",
          providerKind: "work",
          capability: "not-declared",
        }),
      ]),
    });
  });

  it("returns cancellation without starting work when already aborted", async () => {
    const plan = parsedPlan();
    const controller = new AbortController();
    controller.abort();
    const { providers, counts } = makeRegistry(plan);
    const events: ExecutionEvent[] = [];

    const result = await executeRunPlan(
      plan,
      providers,
      () => {
        counts.taskCalls += 1;
      },
      { signal: controller.signal, onEvent: (event) => events.push(event) },
    );

    expect(result.outcome).toBe("cancelled");
    expect(result.failure).toEqual({ code: "cancelled" });
    expect(counts).toEqual({ providerOperations: 0, taskCalls: 0 });
    expect(events.map((event) => event.phase)).toEqual([
      "preflight",
      "cleanup",
      "terminal",
    ]);
  });

  it("keeps mid-run cancellation distinct and still cleans up with an active cleanup signal", async () => {
    const plan = parsedPlan();
    const controller = new AbortController();
    const { providers, counts } = makeRegistry(plan);
    const cleanupOrder: string[] = [];

    const result = await executeRunPlan(
      plan,
      providers,
      async (context) => {
        context.registerCleanup(({ signal }) => {
          expect(signal.aborted).toBe(false);
          cleanupOrder.push("first");
        });
        context.registerCleanup(() => {
          cleanupOrder.push("second");
        });
        controller.abort();
        await expect(
          context.invoke("work", "read", { uri: plan.work.uri }),
        ).rejects.toMatchObject({ code: "cancelled" });
      },
      { signal: controller.signal },
    );

    expect(result.outcome).toBe("cancelled");
    expect(result.failure).toMatchObject({ code: "cancelled" });
    expect(counts.providerOperations).toBe(0);
    expect(cleanupOrder).toEqual(["second", "first"]);
  });

  it("runs every cleanup once in LIFO order and normalizes cleanup failures", async () => {
    const plan = parsedPlan();
    const { providers } = makeRegistry(plan);
    const secret = "cleanup-secret-prompt-payload";
    const order: string[] = [];

    const result = await executeRunPlan(plan, providers, (context) => {
      context.registerCleanup(() => {
        order.push("first");
      });
      context.registerCleanup(() => {
        order.push("second");
        throw new Error(secret);
      });
    });

    expect(result.outcome).toBe("failed");
    expect(result.failure).toEqual({ code: "cleanup_failed" });
    expect(result.cleanup.outcomes).toEqual([
      { index: 1, status: "failed", failure: { code: "cleanup_failed" } },
      { index: 0, status: "succeeded" },
    ]);
    expect(order).toEqual(["second", "first"]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps provider and unknown execution failures secret-free", async () => {
    const plan = parsedPlan();
    const secret = "provider-secret-prompt-payload";
    const { providers } = makeRegistry(plan);
    const failingProviders: ProviderRegistry = {
      ...providers,
      work: {
        ...providers.work,
        read: () => {
          throw new Error(secret);
        },
      },
    };
    const events: ExecutionEvent[] = [];

    const providerResult = await executeRunPlan(
      plan,
      failingProviders,
      (context) => context.invoke("work", "read", { uri: plan.work.uri }),
      { onEvent: (event) => events.push(event) },
    );
    expect(providerResult.outcome).toBe("failed");
    expect(providerResult.failure).toMatchObject({
      code: "provider_failed",
      providerKind: "work",
      providerId: "fake-work",
      operation: "read",
    });

    const unknownResult = await executeRunPlan(plan, providers, () => {
      throw new Error(secret);
    });
    expect(unknownResult.outcome).toBe("failed");
    expect(unknownResult.failure).toEqual({ code: "engine_failed" });
    expect(
      JSON.stringify({ providerResult, unknownResult, events }),
    ).not.toContain(secret);
  });

  it("preserves the primary failure when cleanup also fails", async () => {
    const plan = parsedPlan();
    const { providers } = makeRegistry(plan);

    const result = await executeRunPlan(plan, providers, (context) => {
      context.registerCleanup(() => {
        throw new Error("cleanup-raw-payload");
      });
      throw new Error("primary-raw-payload");
    });

    expect(result.outcome).toBe("failed");
    expect(result.failure).toEqual({ code: "engine_failed" });
    expect(result.cleanup.outcomes).toEqual([
      { index: 0, status: "failed", failure: { code: "cleanup_failed" } },
    ]);
    expect(JSON.stringify(result)).not.toContain("raw-payload");
  });

  it("uses the same plan/context entrypoint for foreground and scheduler callers", async () => {
    const plan = parsedPlan();
    const { providers } = makeRegistry(plan);
    const contexts: string[] = [];

    const runCaller = (caller: "foreground" | "scheduler") =>
      executeRunPlan(plan, providers, (context) => {
        contexts.push(`${caller}:${context.plan.work.uri}`);
      });

    await expect(runCaller("foreground")).resolves.toMatchObject({
      outcome: "succeeded",
    });
    await expect(runCaller("scheduler")).resolves.toMatchObject({
      outcome: "succeeded",
    });
    expect(contexts).toEqual([
      "foreground:akb://reef-test/coll/issues/doc/reef-442.md",
      "scheduler:akb://reef-test/coll/issues/doc/reef-442.md",
    ]);
  });
});
