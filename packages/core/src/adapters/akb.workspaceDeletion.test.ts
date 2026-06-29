import { describe, expect, it } from "vitest";
import {
  AuthError,
  NotFoundError,
  deleteVault,
  detachReef,
  makeAdapter,
  setupFetch,
} from "./akb.testSupport";

const ALL_REEF_TABLES = [
  "reef_settings",
  "monitored_repos",
  "reef_issues",
  "reef_templates",
  "reef_activity_suggestions",
  "reef_comments",
  "reef_activity",
  "reef_sprints",
  "reef_milestones",
  "reef_releases",
];

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

  it("surfaces akb 403 (admin/owner floor) as AuthError and 404 as NotFoundError", async () => {
    setupFetch([
      { status: 403, body: { detail: "Requires 'admin' role" } },
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

describe("detachReef", () => {
  it("deletes reef collections + the root skill doc, then drops every reef table with settings last", async () => {
    // 3 collections + 1 doc + 10 tables = 14 idempotent DELETEs.
    const { calls } = setupFetch(
      Array.from({ length: 14 }, () => ({ status: 204 })),
    );

    await detachReef({
      adapter: makeAdapter(),
      vault: "reef-sample",
      actor: "alice",
    });

    expect(calls).toHaveLength(14);
    expect(calls.every((c) => c.init?.method === "DELETE")).toBe(true);

    const paths = calls.map((c) => pathname(c.url));

    // reef document collections (recursive) + the single shared-collection doc.
    expect(paths).toContain("/api/v1/collections/reef-sample/issues");
    expect(paths).toContain(
      "/api/v1/collections/reef-sample/_reef/activity-inbox",
    );
    expect(paths).toContain("/api/v1/collections/reef-sample/overview/reef");
    expect(paths).toContain(
      "/api/v1/documents/reef-sample/overview/vault-skill.md",
    );

    // recursive=true on every collection delete (akb 409s on a non-empty
    // collection otherwise).
    for (const call of calls) {
      if (pathname(call.url).startsWith("/api/v1/collections/")) {
        expect(new URL(call.url).searchParams.get("recursive")).toBe("true");
      }
    }

    // all 10 reef tables dropped.
    const droppedTables = paths
      .filter((p) => p.startsWith("/api/v1/tables/reef-sample/"))
      .map((p) => p.split("/").pop());
    expect(new Set(droppedTables)).toEqual(new Set(ALL_REEF_TABLES));

    // reef_settings is dropped LAST so has_reef_config only flips once the rest
    // of the teardown has already succeeded.
    expect(pathname(calls.at(-1)?.url)).toBe(
      "/api/v1/tables/reef-sample/reef_settings",
    );
  });

  it("treats an already-gone resource (404) as success — retry-safe", async () => {
    // Every teardown step 404s: a re-run over a half-detached vault must resolve.
    setupFetch(
      Array.from({ length: 14 }, () => ({
        status: 404,
        body: { detail: "gone" },
      })),
    );

    await expect(
      detachReef({
        adapter: makeAdapter(),
        vault: "reef-sample",
        actor: "alice",
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates a non-404 failure (e.g. 403 on a table drop)", async () => {
    // collections + doc succeed; a table drop is forbidden.
    setupFetch([
      { status: 204 },
      { status: 204 },
      { status: 204 },
      { status: 204 },
      { status: 403, body: { detail: "Requires 'admin' role" } },
      ...Array.from({ length: 9 }, () => ({ status: 204 })),
    ]);

    await expect(
      detachReef({
        adapter: makeAdapter(),
        vault: "reef-sample",
        actor: "alice",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
