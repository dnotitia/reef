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
  "reef_attachments",
  "reef_activity",
  "reef_work_events",
  "reef_agent_runs",
  "reef_agent_run_attempts",
  "reef_agent_run_events",
  "reef_sprints",
  "reef_milestones",
  "reef_releases",
];

const EMPTY_ATTACHMENT_QUERY = {
  kind: "table_query",
  columns: ["file_uri"],
  items: [],
  total: 0,
};

const ATTACHMENT_QUERY = {
  ...EMPTY_ATTACHMENT_QUERY,
  items: [
    { file_uri: "akb://reef-sample/issues/reef-001/attachments/file/file-1" },
    { file_uri: "akb://reef-sample/issues/reef-002/attachments/file/file-2" },
  ],
  total: 2,
};

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
  it("deletes only reef-owned documents/files and drops every table, settings last", async () => {
    // 8 vault-skill docs + 2 issue docs + 1 activity-inbox collection
    // + attachment URI query + 2 attachment files + reef tables.
    const { calls } = setupFetch([
      ...Array.from({ length: 11 }, () => ({ status: 204 })),
      { body: ATTACHMENT_QUERY },
      { status: 204 },
      { status: 204 },
      ...Array.from({ length: ALL_REEF_TABLES.length }, () => ({
        status: 204,
      })),
    ]);

    await detachReef({
      adapter: makeAdapter(),
      vault: "reef-sample",
      actor: "alice",
    });

    const paths = calls.map((c) => pathname(c.url));
    expect(
      calls
        .filter((c) => pathname(c.url) !== "/api/v1/tables/reef-sample/sql")
        .every((c) => c.init?.method === "DELETE"),
    ).toBe(true);

    const docDeletes = paths.filter((p) =>
      p.startsWith("/api/v1/documents/reef-sample/"),
    );
    const collectionDeletes = paths.filter((p) =>
      p.startsWith("/api/v1/collections/reef-sample/"),
    );
    const fileDeletes = paths.filter((p) =>
      p.startsWith("/api/v1/files/reef-sample/"),
    );
    const tableDrops = paths.filter(
      (p) => p.startsWith("/api/v1/tables/reef-sample/") && !p.endsWith("/sql"),
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

    // The reef-private `_reef/` namespace is swept by collection (recursive).
    expect(collectionDeletes).toEqual([
      "/api/v1/collections/reef-sample/_reef/activity-inbox",
    ]);
    for (const call of calls) {
      if (pathname(call.url).startsWith("/api/v1/collections/")) {
        expect(new URL(call.url).searchParams.get("recursive")).toBe("true");
      }
    }

    expect(fileDeletes).toEqual([
      "/api/v1/files/reef-sample/file-1",
      "/api/v1/files/reef-sample/file-2",
    ]);
    expect(
      Math.max(...fileDeletes.map((path) => paths.indexOf(path))),
    ).toBeLessThan(
      paths.indexOf("/api/v1/tables/reef-sample/reef_attachments"),
    );

    // All reef tables dropped, reef_settings last (has_reef_config flips last).
    const droppedTables = tableDrops.map((p) => p.split("/").pop());
    expect(new Set(droppedTables)).toEqual(new Set(ALL_REEF_TABLES));
    expect(pathname(calls.at(-1)?.url)).toBe(
      "/api/v1/tables/reef-sample/reef_settings",
    );
  });

  it("treats an already-gone resource (404) as success — retry-safe", async () => {
    // 8 skill docs + 2 issue docs + 1 collection, attachment table already gone,
    // then reef tables all already gone.
    setupFetch([
      ...Array.from({ length: 11 }, () => ({
        status: 404,
        body: { detail: "gone" },
      })),
      { body: { error: 'relation "reef_attachments" does not exist' } },
      ...Array.from({ length: ALL_REEF_TABLES.length }, () => ({
        status: 404,
        body: { detail: "gone" },
      })),
    ]);

    await expect(
      detachReef({
        adapter: makeAdapter(),
        vault: "reef-sample",
        actor: "alice",
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates a non-404 failure (e.g. 403 on a table drop)", async () => {
    // documents + collection + attachment query succeed; a table drop is forbidden.
    setupFetch([
      ...Array.from({ length: 11 }, () => ({ status: 204 })),
      { body: EMPTY_ATTACHMENT_QUERY },
      { status: 403, body: { detail: "Requires 'admin' role" } },
      ...Array.from({ length: ALL_REEF_TABLES.length - 1 }, () => ({
        status: 204,
      })),
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
