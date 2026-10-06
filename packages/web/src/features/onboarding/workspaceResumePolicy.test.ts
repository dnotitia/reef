// @vitest-environment node

import type { EnrichedVaultSummary } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  selectConfiguredWorkspace,
  selectRememberedUnavailableWorkspace,
} from "./workspaceResumePolicy";

function vault(name: string, ready: boolean): EnrichedVaultSummary {
  return {
    name,
    description: null,
    status: "active",
    role: "owner",
    created_at: null,
    installation_status: ready ? "ready" : "not_installed",
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

describe("selectRememberedUnavailableWorkspace", () => {
  it("keeps the remembered accessible workspace as the entry target", () => {
    expect(
      selectRememberedUnavailableWorkspace(
        [vault("reef-zeta", false), vault("raw-vault", false)],
        "reef-zeta",
      ),
    ).toBe("reef-zeta");
  });

  it("does not choose an unremembered or ready workspace", () => {
    expect(
      selectRememberedUnavailableWorkspace(
        [vault("reef-alpha", false), vault("reef-zeta", true)],
        "missing",
      ),
    ).toBeNull();
    expect(
      selectRememberedUnavailableWorkspace(
        [vault("reef-zeta", true)],
        "reef-zeta",
      ),
    ).toBeNull();
  });
});
