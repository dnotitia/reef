import { describe, expect, it } from "vitest";
import type { ProviderCapability, ProviderKind } from "./provider.js";
import {
  type RunPlanInput,
  parseRunPlan,
  safeParseRunPlan,
} from "./runPlan.js";

const provider = (
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
    uri: "akb://reef-test/coll/issues/doc/reef-441.md",
    snapshot: {
      revision: "work-revision",
      provenance: { source: "akb", revision: "source-revision" },
    },
  },
  providers: {
    work: provider("work", "work-provider", ["read", "transition"]),
    harness: provider("harness", "harness-provider", ["start", "stop"]),
    infrastructure: provider("infrastructure", "infra-provider", ["provision"]),
    scm: provider("scm", "scm-provider", ["readBase", "push"]),
    validation: provider("validation", "validation-provider", ["validate"]),
  },
  requiredCapabilities: {
    work: ["read"],
    harness: ["start"],
    infrastructure: ["provision"],
    scm: ["readBase"],
    validation: ["validate"],
  },
  createdAt: "2026-08-04T14:00:00.000Z",
  inputProvenance: { source: "dispatch", revision: "input-revision" },
});

describe("RunPlan", () => {
  it("parses a complete versioned plan with capability-compatible providers", () => {
    const plan = parseRunPlan(validInput());

    expect(plan.schemaVersion).toBe(1);
    expect(plan.work.snapshot.provenance).toEqual({
      source: "akb",
      revision: "source-revision",
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.work)).toBe(true);
    expect(Object.isFrozen(plan.providers.work.capabilities)).toBe(true);
  });

  it("rejects unknown, missing, duplicate, and incompatible fields before mutation", () => {
    const unknownField = { ...validInput(), unexpected: true };
    const unknownResult = safeParseRunPlan(unknownField);
    expect(unknownResult.success).toBe(false);
    if (!unknownResult.success) {
      expect(unknownResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unrecognized_keys", path: [] }),
        ]),
      );
    }

    const completeProviders = validInput().providers;
    const { scm, ...providersWithoutScm } = completeProviders;
    void scm;
    const incomplete = {
      ...validInput(),
      providers: providersWithoutScm,
    };
    const incompleteResult = safeParseRunPlan(incomplete);
    expect(incompleteResult.success).toBe(false);

    const duplicate = validInput();
    duplicate.requiredCapabilities.work = ["read", "read"];
    const duplicateResult = safeParseRunPlan(duplicate);
    expect(duplicateResult.success).toBe(false);

    const incompatible = validInput();
    incompatible.requiredCapabilities.work = ["transition"];
    incompatible.providers.work = provider("work", "work-provider", ["read"]);
    const incompatibleResult = safeParseRunPlan(incompatible);
    expect(incompatibleResult.success).toBe(false);
    if (!incompatibleResult.success) {
      expect(incompatibleResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["requiredCapabilities", "work", 0],
            message: expect.stringContaining("transition"),
          }),
        ]),
      );
    }
  });

  it("deeply snapshots input and prevents nested mutation", () => {
    const input = validInput();
    const plan = parseRunPlan(input);
    input.work.snapshot.revision = "mutated-input";
    input.providers.work.capabilities[0] = "transition";

    expect(plan.work.snapshot.revision).toBe("work-revision");
    expect(plan.providers.work.capabilities).toEqual(["read", "transition"]);
    expect(() => {
      (plan.providers.work.capabilities as string[]).push("refresh");
    }).toThrow(TypeError);
    expect(() => {
      (plan.work.snapshot as { revision: string }).revision = "mutated-plan";
    }).toThrow(TypeError);
  });
});
