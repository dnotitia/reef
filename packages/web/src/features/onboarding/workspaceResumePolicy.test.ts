// @vitest-environment node

import type { EnrichedVaultSummary } from "@reef/core";
import { describe, expect, it } from "vitest";
import { selectConfiguredWorkspace } from "./workspaceResumePolicy";

function vault(name: string, hasReefConfig: boolean): EnrichedVaultSummary {
  return {
    name,
    description: null,
    status: "active",
    role: "owner",
    created_at: null,
    has_reef_config: hasReefConfig,
  };
}

describe("selectConfiguredWorkspace", () => {
  it("prefers a remembered configured workspace", () => {
    expect(
      selectConfiguredWorkspace(
        [vault("reef-alpha", true), vault("reef-zeta", true)],
        "reef-zeta",
      ),
    ).toBe("reef-zeta");
  });

  it("ignores raw vaults and chooses the first configured ASCII name", () => {
    expect(
      selectConfiguredWorkspace(
        [
          vault("raw-alpha", false),
          vault("reef-zeta", true),
          vault("reef-alpha", true),
        ],
        "missing",
      ),
    ).toBe("reef-alpha");
  });

  it("returns null when no configured workspace is accessible", () => {
    expect(
      selectConfiguredWorkspace([vault("raw-alpha", false)], ""),
    ).toBeNull();
  });
});
