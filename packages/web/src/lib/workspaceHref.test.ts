// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WORKSPACE_PREFIX, withVault } from "./workspaceHref";

describe("withVault (REEF-315)", () => {
  it("prefixes a dashboard path with the workspace segment", () => {
    expect(withVault("reef-acme", "/issues")).toBe(
      "/workspace/reef-acme/issues",
    );
    expect(withVault("reef-acme", "/settings/workspace")).toBe(
      "/workspace/reef-acme/settings/workspace",
    );
  });

  it("carries a query string through unchanged", () => {
    expect(withVault("reef-acme", "/issues?view=list&status=todo")).toBe(
      "/workspace/reef-acme/issues?view=list&status=todo",
    );
  });

  it("normalizes a missing leading slash", () => {
    expect(withVault("reef-acme", "issues")).toBe(
      "/workspace/reef-acme/issues",
    );
  });

  it("sends callers without a valid vault to onboarding", () => {
    expect(withVault("", "/issues")).toBe("/onboarding");
    expect(withVault("/issues", "issues")).toBe("/onboarding");
    expect(withVault("Bad_Vault", "/issues")).toBe("/onboarding");
    expect(withVault("has space", "/issues")).toBe("/onboarding");
  });

  it("exposes the fixed prefix constant", () => {
    expect(WORKSPACE_PREFIX).toBe("/workspace");
  });
});
