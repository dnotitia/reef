import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
  DevelopmentBranchTemplateSchema,
  DevelopmentRecipePathSchema,
  DevelopmentTargetConfigSchema,
  renderDevelopmentBranchTemplate,
  resolveDevelopmentTargetEligibility,
} from "./developmentTargets";

const enabledTarget = {
  github_id: 1001,
  enabled: true,
  recipe_path: ".reef/agent.yml",
  runner_profile: "default",
  permission_profile: ":workspace",
  branch_template: "agent/{issue_id}/{run_id}",
};

describe("development target schemas", () => {
  it("accepts an enabled target with deployment profile references", () => {
    expect(DevelopmentTargetConfigSchema.parse(enabledTarget)).toEqual(
      enabledTarget,
    );
  });

  it("keeps disabled target values but requires every policy field when enabled", () => {
    expect(
      DevelopmentTargetConfigSchema.safeParse({
        github_id: 1001,
        enabled: false,
      }).success,
    ).toBe(true);
    expect(
      DevelopmentTargetConfigSchema.safeParse({
        github_id: 1001,
        enabled: true,
      }).success,
    ).toBe(false);
  });

  it.each(["/tmp/recipe.yml", "../recipe.yml", "dir\\recipe.yml", "a//b"])(
    "rejects unsafe recipe path %s",
    (value) => {
      expect(DevelopmentRecipePathSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects unsupported placeholders and unsafe rendered refs", () => {
    expect(
      DevelopmentBranchTemplateSchema.safeParse("agent/{unknown}").success,
    ).toBe(false);
    expect(
      DevelopmentBranchTemplateSchema.safeParse("agent/../{run_id}").success,
    ).toBe(false);
    expect(
      DevelopmentBranchTemplateSchema.safeParse("agent/.hidden/{run_id}")
        .success,
    ).toBe(false);
    expect(DevelopmentBranchTemplateSchema.safeParse("HEAD").success).toBe(
      false,
    );
    expect(
      renderDevelopmentBranchTemplate("agent/{issue_id}/{run_id}", {
        issue_id: "REEF-381",
        run_id: "run-1",
      }),
    ).toBe("agent/REEF-381/run-1");
  });

  it("fails closed for missing, disabled, duplicate, and unavailable targets", () => {
    expect(
      resolveDevelopmentTargetEligibility({
        config: null,
        catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
      }).reason,
    ).toBe("target_missing");
    expect(
      resolveDevelopmentTargetEligibility({
        config: { ...enabledTarget, enabled: false },
        catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
      }).reason,
    ).toBe("target_disabled");
    expect(
      resolveDevelopmentTargetEligibility({
        config: enabledTarget,
        catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
        duplicate: true,
      }).reason,
    ).toBe("target_invalid");
    expect(
      resolveDevelopmentTargetEligibility({
        config: { ...enabledTarget, runner_profile: "retired" },
        catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
      }).reason,
    ).toBe("profile_unavailable");
    expect(
      resolveDevelopmentTargetEligibility({
        config: enabledTarget,
        catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
      }),
    ).toEqual({ eligible: true, reason: null });
  });
});
