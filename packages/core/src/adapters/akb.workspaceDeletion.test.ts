import { describe, expect, it, vi } from "vitest";

// detachReef deletes reef issue documents by their deterministic id→path, so it
// reads the issue list. Mock that read; the rest of the teardown goes through the
// fetch mock below.
vi.mock("./akb/issues/issues", async () => {
  const actual = await vi.importActual<typeof import("./akb/issues/issues")>(
    "./akb/issues/issues",
  );
  return {
    ...actual,
    listIssues: (async () => ({
      issues: [{ id: "REEF-001" }, { id: "REEF-002" }],
    })) as unknown as (typeof actual)["listIssues"],
  };
});

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
  it("deletes only reef-owned documents (issue docs by id + vault-skill) and drops every table, settings last", async () => {
    // 8 vault-skill docs + 2 issue docs + 1 activity-inbox collection + 10 tables.
    const { calls } = setupFetch(
      Array.from({ length: 21 }, () => ({ status: 204 })),
    );

    await detachReef({
      adapter: makeAdapter(),
      vault: "reef-sample",
      actor: "alice",
    });

    expect(calls.every((c) => c.init?.method === "DELETE")).toBe(true);
    const paths = calls.map((c) => pathname(c.url));

    const docDeletes = paths.filter((p) =>
      p.startsWith("/api/v1/documents/reef-sample/"),
    );
    const collectionDeletes = paths.filter((p) =>
      p.startsWith("/api/v1/collections/reef-sample/"),
    );
    const tableDrops = paths.filter((p) =>
      p.startsWith("/api/v1/tables/reef-sample/"),
    );

    // Issue documents are deleted by their deterministic id→path, NOT by
    // recursively clearing the shared-name `issues/` collection (which could hold
    // non-reef docs). This is the data-loss guard.
    expect(docDeletes).toContain(
      "/api/v1/documents/reef-sample/issues/reef-001.md",
    );
    expect(docDeletes).toContain(
      "/api/v1/documents/reef-sample/issues/reef-002.md",
    );
    expect(collectionDeletes).not.toContain(
      "/api/v1/collections/reef-sample/issues",
    );

    // Vault-skill docs are deleted by their exact installed paths.
    expect(docDeletes).toContain(
      "/api/v1/documents/reef-sample/overview/vault-skill.md",
    );
    // 8 vault-skill docs + 2 issue docs.
    expect(docDeletes).toHaveLength(10);

    // Only the reef-private `_reef/` namespace is swept by collection (recursive).
    expect(collectionDeletes).toEqual([
      "/api/v1/collections/reef-sample/_reef/activity-inbox",
    ]);
    for (const call of calls) {
      if (pathname(call.url).startsWith("/api/v1/collections/")) {
        expect(new URL(call.url).searchParams.get("recursive")).toBe("true");
      }
    }

    // All 10 reef tables dropped, reef_settings last (has_reef_config flips last).
    const droppedTables = tableDrops.map((p) => p.split("/").pop());
    expect(new Set(droppedTables)).toEqual(new Set(ALL_REEF_TABLES));
    expect(pathname(calls.at(-1)?.url)).toBe(
      "/api/v1/tables/reef-sample/reef_settings",
    );
  });

  it("treats an already-gone resource (404) as success — retry-safe", async () => {
    // 8 skill docs + 2 issue docs + 1 collection + 10 tables, all already gone.
    setupFetch(
      Array.from({ length: 21 }, () => ({
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
    // documents + collection succeed; a table drop is forbidden.
    setupFetch([
      ...Array.from({ length: 11 }, () => ({ status: 204 })),
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
