import { describe, expect, it } from "vitest";
import { AuthError, NotFoundError } from "../../../errors";
import { deleteVault } from "./workspaceDeletion";
import { makeAdapter, setupFetch } from "../core/httpTestSupport";

function pathname(url: string | undefined): string {
  return new URL(url ?? "").pathname;
}

describe("deleteVault", () => {
  it("issues a single DELETE to the vault endpoint", async () => {
    const { calls } = setupFetch([{ status: 204 }]);

    await deleteVault({
      adapter: makeAdapter(),
      vault: "reef-sample",
      actor: "alice",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(pathname(calls[0]?.url)).toBe("/api/v1/vaults/reef-sample");
  });

  it("surfaces AKB permission denial and missing vault errors", async () => {
    setupFetch([
      { status: 403, body: { detail: "Requires admin role" } },
      { status: 404, body: { detail: "vault not found" } },
    ]);
    const adapter = makeAdapter();

    await expect(
      deleteVault({ adapter, vault: "reef-sample", actor: "alice" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      deleteVault({ adapter, vault: "reef-sample", actor: "alice" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
