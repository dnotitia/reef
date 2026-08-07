import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";
import {
  HARNESS_CAPABILITIES,
  type HarnessProvider,
  INFRASTRUCTURE_CAPABILITIES,
  type InfrastructureProvider,
  ProviderError,
  ProviderIdentitySchema,
  SCM_CAPABILITIES,
  type ScmProvider,
  VALIDATION_CAPABILITIES,
  type ValidationProvider,
  WORK_CAPABILITIES,
  type WorkProvider,
  executeProviderOperation,
  invokeProviderOperation,
} from "./provider.js";

const workProvider: WorkProvider = {
  kind: "work",
  id: "fake-work",
  version: "1.0.0",
  capabilities: WORK_CAPABILITIES,
  read: ({ uri }) => ({
    uri,
    revision: "work-revision",
    provenance: { source: "fake", revision: "source-revision" },
  }),
  refresh: ({ uri }) => ({
    uri,
    revision: "work-revision",
    provenance: { source: "fake", revision: "source-revision" },
  }),
  transition: ({ uri }) => ({
    uri,
    revision: "work-revision",
    provenance: { source: "fake", revision: "source-revision" },
  }),
  report: (report) => report,
  linkArtifact: ({ artifact }) => artifact,
};

const harnessProvider: HarnessProvider = {
  kind: "harness",
  id: "fake-harness",
  version: "1.0.0",
  capabilities: HARNESS_CAPABILITIES,
  start: () => ({ session: { name: "session", revision: "1" } }),
  observe: () => ({ state: "ready", events: [] }),
  sendInput: () => ({ accepted: true }),
  interrupt: () => ({ interrupted: true }),
  resume: () => ({ session: { name: "session", revision: "1" } }),
  stop: () => ({ stopped: true }),
};

const infrastructureProvider: InfrastructureProvider = {
  kind: "infrastructure",
  id: "fake-infrastructure",
  version: "1.0.0",
  capabilities: INFRASTRUCTURE_CAPABILITIES,
  provision: () => ({ resource: { name: "resource", revision: "1" } }),
  exec: () => ({ exitCode: 0 }),
  sync: ({ resource, revision }) => ({ resource, revision }),
  collect: () => ({ artifacts: [] }),
  cleanup: () => ({ cleaned: true }),
};

const scmProvider: ScmProvider = {
  kind: "scm",
  id: "fake-scm",
  version: "1.0.0",
  capabilities: SCM_CAPABILITIES,
  readBase: () => ({ name: "main", revision: "base" }),
  readRef: () => ({ name: "ref", revision: "revision" }),
  createBranch: () => ({ name: "branch", revision: "revision" }),
  commit: () => ({ name: "commit", revision: "revision" }),
  push: () => ({ name: "push", revision: "revision" }),
  createDraftPullRequest: () => ({ kind: "pull_request", ref: "1" }),
  collectArtifact: () => ({ kind: "file", ref: "artifact" }),
};

const validationProvider: ValidationProvider = {
  kind: "validation",
  id: "fake-validation",
  version: "1.0.0",
  capabilities: VALIDATION_CAPABILITIES,
  validate: ({ candidateRevision, contractRevision }) => ({
    status: "passed",
    candidateRevision,
    contractRevision,
    totalDurationMs: 0,
    checks: [],
    artifacts: [],
  }),
};

describe("provider contract", () => {
  it("exports the provider contract from the package root", () => {
    expect(publicApi.ProviderError).toBe(ProviderError);
    expect(publicApi.RunPlanSchema).toBeDefined();
    expect(publicApi.invokeProviderOperation).toBe(invokeProviderOperation);
  });

  it("rejects duplicate and cross-kind capability declarations", () => {
    expect(
      ProviderIdentitySchema.safeParse({
        kind: "work",
        id: "fake-work",
        version: "1.0.0",
        capabilities: ["read", "read"],
      }).success,
    ).toBe(false);
    expect(
      ProviderIdentitySchema.safeParse({
        kind: "work",
        id: "fake-work",
        version: "1.0.0",
        capabilities: ["validate"],
      }).success,
    ).toBe(false);
  });

  it("composes typed providers for every declared kind", async () => {
    await expect(
      invokeProviderOperation(workProvider, "read", { uri: "akb://reef/work" }),
    ).resolves.toMatchObject({ uri: "akb://reef/work" });
    await expect(
      invokeProviderOperation(harnessProvider, "observe", {
        session: { name: "session", revision: "1" },
      }),
    ).resolves.toEqual({ state: "ready", events: [] });
    await expect(
      invokeProviderOperation(infrastructureProvider, "cleanup", {
        resource: { name: "resource", revision: "1" },
      }),
    ).resolves.toEqual({ cleaned: true });
    await expect(
      invokeProviderOperation(scmProvider, "push", {
        repository: "dnotitia/reef",
        ref: "main",
      }),
    ).resolves.toMatchObject({ revision: "revision" });
    await expect(
      invokeProviderOperation(validationProvider, "validate", {
        candidateRevision: "candidate",
        contractRevision: "contract",
        checks: [
          {
            name: "check",
            command: "true",
            timeoutMs: 1_000,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: "passed" });
  });

  it("rejects unsupported capability before the operation is called", async () => {
    let called = false;
    const provider = { ...workProvider, capabilities: ["read"] as const };

    await expect(
      executeProviderOperation(provider, "transition", "transition", () => {
        called = true;
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      providerKind: "work",
      providerId: "fake-work",
      operation: "transition",
      capability: "transition",
      retryable: false,
    });
    expect(called).toBe(false);
  });

  it("normalizes failure and cancellation without serializing raw errors", async () => {
    const failureMarker = "provider-hidden-prompt-payload";
    await expect(
      executeProviderOperation(workProvider, "read", "read", () => {
        throw new Error(failureMarker);
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderError);
      expect(JSON.stringify(error)).not.toContain(failureMarker);
      expect(error).toMatchObject({
        code: "protocol",
        providerKind: "work",
        providerId: "fake-work",
        operation: "read",
        retryable: true,
      });
      return true;
    });

    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      executeProviderOperation(
        workProvider,
        "read",
        "read",
        () => {
          called = true;
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      code: "cancelled",
      operation: "read",
      retryable: false,
    });
    expect(called).toBe(false);
  });
});
