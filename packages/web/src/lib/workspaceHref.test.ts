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

  it("returns the bare path when the vault is empty (falls through to the legacy shim)", () => {
    expect(withVault("", "/issues")).toBe("/issues");
    expect(withVault("", "issues")).toBe("/issues");
  });

  it("returns the bare path for a malformed vault name", () => {
    // Uppercase / illegal chars do not name a real akb vault, so skip building a
    // bogus /workspace/{bad}/… URL.
    expect(withVault("Bad_Vault", "/issues")).toBe("/issues");
    expect(withVault("has space", "/issues")).toBe("/issues");
  });

  it("exposes the fixed prefix constant", () => {
    expect(WORKSPACE_PREFIX).toBe("/workspace");
  });
});
