import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, IssueRelationBackfillError } from "../../../errors";
import type { IssueRelationCheckpoint } from "../../../schemas/issueRelationBackfill";
import { makeSqlQueryResponse, setupFetch } from "../core/akb.testSupport";
import {
  applyIssueRelationUris,
  preflightIssueRelationUris,
  verifyIssueRelationUris,
} from "./relationBackfill";
import { relationRow, relationServer } from "./relationBackfill.testSupport";
const BACKFILL_CONFIG = {
  baseUrl: "https://akb.test",
  credential: "jwt.example.token",
};
const VAULT_ACTOR = { auth_method: "jwt", is_admin: true };
const VAULT_INFO = {
  status: "active",
  is_archived: false,
  is_external_git: false,
  managed_by: null,
  role: "admin",
};

describe("issue relation repair authority", () => {
  it.each([
    [
      "archived vault",
      {
        status: "archived",
        is_archived: true,
        is_external_git: false,
        managed_by: null,
        role: "admin",
        role_source: "system_admin",
      },
    ],
    [
      "external mirror",
      {
        status: "active",
        is_archived: false,
        is_external_git: true,
        managed_by: null,
        role: "admin",
        role_source: "system_admin",
      },
    ],
  ])("rejects %s before document writes", async (_label, info) => {
    const { calls } = setupFetch([{ body: info }]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).rejects.toThrow();
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
    expect(calls[0]?.url).toContain("/vaults/reef-sample/info");
  });

  it("rejects a SELECT scope denial without patching documents", async () => {
    const { calls } = setupFetch([
      {
        body: {
          status: "active",
          is_archived: false,
          is_external_git: false,
          managed_by: null,
          role: "admin",
          role_source: "system_admin",
        },
      },
      { body: VAULT_ACTOR },
      { status: 403, body: { detail: { code: "insufficient_scope" } } },
    ]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).rejects.toThrow();
    expect(calls[2]?.url).toContain("/tables/reef-sample/sql");
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
  });
  it("does not treat an unknown credential kind as verified", async () => {
    const { calls } = setupFetch([
      { body: VAULT_INFO },
      { body: { auth_method: "unknown", is_admin: true } },
    ]);
    await expect(
      preflightIssueRelationUris({ ...BACKFILL_CONFIG, vault: "reef-sample" }),
    ).rejects.toThrow();
    expect(calls[1]?.url).toContain("/auth/me");
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
  });
  it("accepts the documented unscoped administrator bypass for a managed vault", async () => {
    const { calls } = setupFetch([
      { body: { ...VAULT_INFO, managed_by: "owner:example" } },
      { body: { auth_method: "jwt", is_admin: true } },
      {
        body: makeSqlQueryResponse(
          [],
          [
            "reef_id",
            "document_uri",
            "depends_on",
            "related_to",
            "blocks",
            "updated_at",
          ],
        ),
      },
    ]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 0 });
    expect(calls[1]?.url).toContain("/auth/me");
  });
  it("accepts an OAuth administrator with the same AKB write-policy bypass", async () => {
    setupFetch([
      { body: { ...VAULT_INFO, managed_by: "owner:example" } },
      { body: { auth_method: "oauth", is_admin: true } },
      {
        body: makeSqlQueryResponse(
          [],
          [
            "reef_id",
            "document_uri",
            "depends_on",
            "related_to",
            "blocks",
            "updated_at",
          ],
        ),
      },
    ]);
    await expect(
      preflightIssueRelationUris({ ...BACKFILL_CONFIG, vault: "reef-sample" }),
    ).resolves.toEqual({ count: 0 });
  });
  it("accepts legacy unscoped PAT metadata after SQL confirms its write scope", async () => {
    const credential = "akb_abcdefgh-synthetic-secret";
    setupFetch([
      { body: { ...VAULT_INFO, managed_by: "owner:example" } },
      { body: { auth_method: "pat", is_admin: true, key_class: "pat" } },
      {
        body: {
          tokens: [
            {
              token_id: "11111111-1111-4111-8111-111111111111",
              prefix: credential.slice(0, 12),
              scopes: [],
              vault_scope: null,
              key_class: "pat",
            },
          ],
        },
      },
      {
        body: makeSqlQueryResponse(
          [],
          [
            "reef_id",
            "document_uri",
            "depends_on",
            "related_to",
            "blocks",
            "updated_at",
          ],
        ),
      },
    ]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        credential,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 0 });
  });

  it("fails closed when managed vault write authority cannot be established", async () => {
    const { calls } = setupFetch([
      { body: { ...VAULT_INFO, managed_by: "owner:example" } },
      { body: { auth_method: "pat", is_admin: true, key_class: "pat" } },
    ]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).rejects.toThrow();
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
  });

  it.each([null, { prefixes: [], extra_vaults: ["reef-sample"] }])(
    "checks the matching managed-vault PAT scope %s",
    async (scope) => {
      const credential = "akb_abcdefgh-synthetic-secret";
      const tokenId = "11111111-1111-4111-8111-111111111111";
      const { calls } = setupFetch([
        { body: { ...VAULT_INFO, managed_by: "owner:example" } },
        { body: { auth_method: "pat", is_admin: true, key_class: "pat" } },
        {
          body: {
            tokens: [
              {
                token_id: tokenId,
                prefix: credential.slice(0, 12),
                scopes: ["write"],
                vault_scope: scope,
                key_class: "pat",
              },
            ],
          },
        },
        ...(scope
          ? [
              {
                body: {
                  token_id: tokenId,
                  vault_scope: scope,
                  authorities: [
                    { vault: "reef-sample", role: "writer", action: "*" },
                  ],
                },
              },
            ]
          : []),
        {
          body: makeSqlQueryResponse(
            [],
            [
              "reef_id",
              "document_uri",
              "depends_on",
              "related_to",
              "blocks",
              "updated_at",
            ],
          ),
        },
      ]);
      await expect(
        preflightIssueRelationUris({
          ...BACKFILL_CONFIG,
          vault: "reef-sample",
          ...{ credential },
        }),
      ).resolves.toEqual({ count: 0 });
      if (scope) {
        const verify = calls.find((call) =>
          call.url.endsWith("/auth/authority/verify"),
        );
        expect(JSON.parse(String(verify?.init?.body))).toEqual({
          vault_scope: scope,
          writer_authorities: [{ vault: "reef-sample", action: "*" }],
        });
      }
    },
  );

  it.each(["ambiguous", "missing", "mismatch", "denied"])(
    "fails closed for %s managed PAT authority",
    async (failure) => {
      const credential = "akb_abcdefgh-synthetic-secret";
      const tokenId = "11111111-1111-4111-8111-111111111111";
      const scope = { prefixes: [], extra_vaults: ["reef-sample"] };
      const token = {
        token_id: tokenId,
        prefix: credential.slice(0, 12),
        scopes: ["write"],
        vault_scope: scope,
        key_class: "pat",
      };
      const { calls } = setupFetch([
        { body: { ...VAULT_INFO, managed_by: "owner:example" } },
        { body: { auth_method: "pat", is_admin: true, key_class: "pat" } },
        {
          body: {
            tokens:
              failure === "missing"
                ? []
                : failure === "ambiguous"
                  ? [
                      token,
                      {
                        ...token,
                        token_id: "22222222-2222-4222-8222-222222222222",
                      },
                    ]
                  : [token],
          },
        },
        ...(["ambiguous", "missing"].includes(failure)
          ? []
          : failure === "denied"
            ? [{ status: 403, body: { detail: "denied" } }]
            : [
                {
                  body: {
                    token_id: "22222222-2222-4222-8222-222222222222",
                    vault_scope: scope,
                    authorities: [
                      { vault: "reef-sample", role: "writer", action: "*" },
                    ],
                  },
                },
              ]),
      ]);
      await expect(
        preflightIssueRelationUris({
          ...BACKFILL_CONFIG,
          vault: "reef-sample",
          ...{ credential },
        }),
      ).rejects.toThrow();
      expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
    },
  );
});

describe("issue relation repair", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function harness(rows = [relationRow()]) {
    const server = relationServer(rows),
      saved = new Map<string, IssueRelationCheckpoint>();
    const config = {
      ...BACKFILL_CONFIG,
      vault: "reef-sample",
      fetch: server.fetch,
    };
    const apply = () =>
      applyIssueRelationUris({
        ...config,
        checkpoints: [...saved.values()],
        onCheckpoint: async (entry) => {
          saved.set(entry.reef_id, entry);
        },
      });
    const verify = (verificationTimeoutMs = 30 * 60_000) =>
      verifyIssueRelationUris({
        ...config,
        checkpoints: [...saved.values()],
        verificationTimeoutMs,
      });
    return { ...server, saved, config, apply, verify };
  }
  it("collects invalid references across rows before any document mutation", async () => {
    const h = harness([
      relationRow("REEF-001", {
        depends_on: ["MISSING-001"],
        related_to: ["akb://other/coll/issues/doc/a.md"],
      }),
      relationRow("REEF-002", {
        blocks: ["akb://reef-sample/coll/issues/doc/reef-001.md"],
      }),
    ]);
    const result = await preflightIssueRelationUris(h.config).catch(
      (e: unknown) => e,
    );
    expect(result).toBeInstanceOf(IssueRelationBackfillError);
    if (!(result instanceof IssueRelationBackfillError))
      throw Error("Expected diagnostic report");
    expect(result.report).toMatchObject({
      phase: "preflight",
      code: "invalid_relations",
      problems: [
        {
          reef_id: "REEF-001",
          field: "depends_on",
          reason: "missing_target",
          target_index: 0,
        },
        {
          reef_id: "REEF-001",
          field: "related_to",
          reason: "cross_vault_reference",
        },
        {
          reef_id: "REEF-002",
          field: "blocks",
          reason: "document_uri_in_row",
          replacement_reef_id: "REEF-001",
        },
      ],
    });
    expect(h.patches).toEqual([]);
  });
  it("preflights all backing documents, including the last page", async () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      relationRow(`REEF-${String(index + 1).padStart(3, "0")}`),
    );
    const h = harness(rows);
    h.archived.add(rows[200].reef_id);
    h.documents.delete(rows[200].document_uri);
    await expect(h.apply()).rejects.toMatchObject({
      report: {
        code: "document_missing",
        problems: [{ reef_id: "REEF-201", reason: "missing_document" }],
      },
    });
    expect(h.patches).toEqual([]);
  });
  it("validates relationships beyond the first inventory page before patching", async () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      relationRow(`REEF-${String(index + 1).padStart(3, "0")}`),
    );
    rows[200].depends_on = ["MISSING-001"];
    const h = harness(rows);
    await expect(h.apply()).rejects.toMatchObject({
      report: {
        code: "invalid_relations",
        problems: [{ reef_id: "REEF-201" }],
      },
    });
    expect(h.patches).toEqual([]);
  });
  it("rejects invalid arrays and duplicate or cross-vault document identities", async () => {
    const first = relationRow("REEF-001", { depends_on: "invalid json" });
    const h = harness([
      first,
      relationRow("REEF-002", { document_uri: first.document_uri }),
      relationRow("REEF-003", {
        document_uri: "akb://other/coll/issues/doc/c.md",
      }),
    ]);
    await expect(h.apply()).rejects.toMatchObject({
      report: {
        code: "invalid_relations",
        problems: expect.arrayContaining([
          {
            reef_id: "REEF-001",
            field: "depends_on",
            reason: "malformed_array",
          },
          { reef_id: "REEF-002", reason: "invalid_document_identity" },
          { reef_id: "REEF-003", reason: "invalid_document_identity" },
        ]),
      },
    });
    expect(h.patches).toEqual([]);
  });
  it("writes stored target URIs under expected_commit and checkpoints only acknowledged commits", async () => {
    const h = harness([
      relationRow("REEF-001", {
        depends_on: ["REEF-002"],
        blocks: ["REEF-002"],
        related_to: ["REEF-002"],
      }),
      relationRow("REEF-002"),
    ]);
    await expect(h.apply()).resolves.toMatchObject({ count: 2 });
    expect(h.patches[0]).toEqual({
      uri: "akb://reef-sample/coll/issues/doc/reef-001.md",
      expected_commit: "initial",
      depends_on: ["akb://reef-sample/coll/issues/doc/reef-002.md"],
      related_to: ["akb://reef-sample/coll/issues/doc/reef-002.md"],
    });
    expect(h.saved.get("REEF-001")).toMatchObject({
      document_commit: "written-1",
    });
    expect(
      h.documents.get("akb://reef-sample/coll/issues/doc/reef-001.md")?.body,
    ).toBe("untouched body");
    expect(
      h.requests.every((request) => request.signal instanceof AbortSignal),
    ).toBe(true);
  });
  it("awaits checkpoint persistence before starting the next document", async () => {
    const h = harness([relationRow(), relationRow("REEF-002")]);
    let acknowledge: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const applying = applyIssueRelationUris({
      ...h.config,
      checkpoints: [],
      onCheckpoint: async () => held,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.patches).toHaveLength(1);
    acknowledge();
    await applying;
    expect(h.patches).toHaveLength(2);
  });
  it("resumes a partial write without rewriting a successfully checkpointed document", async () => {
    const first = relationRow(),
      second = relationRow("REEF-002");
    const h = harness([first, second]);
    h.failures.add(second.document_uri);
    await expect(h.apply()).rejects.toBeInstanceOf(Error);
    expect(h.saved.size).toBe(1);
    h.failures.clear();
    await h.apply();
    expect(h.patches.map((p) => p.uri)).toEqual([
      first.document_uri,
      second.document_uri,
    ]);
    expect(await h.verify()).toEqual({ count: 2 });
  });
  it("reuses checkpoints after unrelated row changes but refreshes a moved document head", async () => {
    const row = relationRow();
    const h = harness([row]);
    await h.apply();
    row.updated_at = "2026-02-01T00:00:00Z";
    await h.apply();
    expect(h.patches).toHaveLength(1);
    const doc = h.documents.get(row.document_uri);
    if (!doc) throw Error("missing fixture");
    doc.commit = "external-edit";
    doc.body = "new user body";
    await expect(h.verify()).rejects.toBeInstanceOf(ConflictError);
    await h.apply();
    expect(h.patches[1]?.expected_commit).toBe("external-edit");
    expect(doc.body).toBe("new user body");
  });
  it("refreshes only changed relationship projections and includes new issues", async () => {
    const first = relationRow(),
      second = relationRow("REEF-002");
    const h = harness([first, second]);
    await h.apply();
    first.depends_on = ["REEF-002"];
    first.updated_at = "2026-02-01T00:00:00Z";
    h.add(relationRow("REEF-003"));
    await expect(h.verify()).rejects.toBeInstanceOf(ConflictError);
    await h.apply();
    expect(h.patches.map((p) => p.uri)).toEqual([
      first.document_uri,
      second.document_uri,
      first.document_uri,
      "akb://reef-sample/coll/issues/doc/reef-003.md",
    ]);
    expect(await h.verify()).toEqual({ count: 3 });
  });
  it("restarts a write snapshot when an issue appears during a guarded patch", async () => {
    const h = harness();
    let changed = false;
    h.controls.onPatch = () => {
      if (!changed) {
        changed = true;
        h.add(relationRow("REEF-002"));
      }
    };
    expect(await h.apply()).toMatchObject({ count: 2 });
    expect(h.patches).toHaveLength(2);
  });
  it("requires a fresh write snapshot when a row changes during verification", async () => {
    const row = relationRow();
    const h = harness([row]);
    await h.apply();
    h.controls.onGraphRead = () => {
      row.updated_at = "2026-02-01T00:00:00Z";
    };
    await expect(h.verify()).rejects.toBeInstanceOf(ConflictError);
    h.controls.onGraphRead = undefined;
    await h.apply();
    expect(h.patches).toHaveLength(1);
    expect(await h.verify()).toEqual({ count: 1 });
  });
  it("waits past ten seconds for projection and retries verification without writes", async () => {
    const row = relationRow("REEF-001", { depends_on: ["REEF-002"] });
    const h = harness([row, relationRow("REEF-002")]);
    h.controls.autoProject = false;
    await h.apply();
    const first = h.verify(10_000).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({
      report: {
        phase: "verify",
        code: "projection_pending",
        problems: [{ reef_id: "REEF-001", missing_count: 1 }],
      },
    });
    h.project(row.document_uri);
    expect(await h.verify()).toEqual({ count: 2 });
    expect(h.patches).toHaveLength(2);
    h.controls.autoProject = true;
    await h.apply();
    expect(h.patches).toHaveLength(2);
  });
  it("allows a delayed projection to converge within the configured wait budget", async () => {
    const h = harness([
      relationRow("REEF-001", { depends_on: ["REEF-002"] }),
      relationRow("REEF-002"),
    ]);
    h.controls.projectionDelay = 60_000;
    await h.apply();
    const outcome = h.verify().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ count: 2 });
    expect(h.patches).toHaveLength(2);
  });
  it("preserves independent same-workspace explicit edges while accepting expected explicit edges", async () => {
    const first = relationRow(),
      second = relationRow("REEF-002", { depends_on: ["REEF-001"] });
    const h = harness([first, second]);
    h.graph.set(first.document_uri, [
      { uri: second.document_uri, relation: "depends_on", kind: "explicit" },
    ]);
    h.graph.set(second.document_uri, [
      { uri: first.document_uri, relation: "depends_on", kind: "explicit" },
      {
        uri: "akb://reef-sample/coll/notes/doc/other.md",
        relation: "related_to",
        kind: "explicit",
      },
    ]);
    await h.apply();
    const outcome = h.verify(1).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ count: 2 });
    expect(h.graph.get(first.document_uri)).toEqual([
      { uri: second.document_uri, relation: "depends_on", kind: "explicit" },
    ]);
    expect(
      h.requests.some(
        (r) =>
          r.method === "DELETE" ||
          (r.path === "/api/v1/relations" && r.method !== "GET"),
      ),
    ).toBe(false);
  });
  it("still rejects unexpected implicit edges, including an edge outside the issue inventory", async () => {
    const row = relationRow();
    const h = harness([row]);
    await h.apply();
    h.graph.set(row.document_uri, [
      {
        uri: "akb://reef-sample/coll/notes/doc/stale.md",
        relation: "related_to",
        kind: "implicit",
      },
    ]);
    const result = h.verify(1).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({
      report: {
        code: "projection_pending",
        problems: [
          { reef_id: "REEF-001", field: "related_to", unexpected_count: 1 },
        ],
      },
    });
  });
  it("stops further writes when an acknowledged commit cannot be persisted", async () => {
    const h = harness([relationRow(), relationRow("REEF-002")]);
    await expect(
      applyIssueRelationUris({
        ...h.config,
        checkpoints: [],
        onCheckpoint: async () => {
          throw Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(h.patches).toHaveLength(1);
  });
  it("bounds retries when the source keeps changing", async () => {
    const row = relationRow(),
      h = harness([row]);
    let revision = 0;
    h.controls.onRowsRead = () => {
      row.updated_at = new Date(
        Date.parse("2026-02-01T00:00:00Z") + revision++ * 1000,
      ).toISOString();
    };
    await expect(h.apply()).rejects.toBeInstanceOf(ConflictError);
    expect(h.patches).toHaveLength(0);
  });
  it("retries document OCC without overwriting an external body edit", async () => {
    const row = relationRow(),
      h = harness([row]);
    let raced = false;
    h.controls.beforePatch = () => {
      if (!raced) {
        raced = true;
        const doc = h.documents.get(row.document_uri);
        if (!doc) throw Error("missing fixture");
        doc.commit = "external-winner";
        doc.body = "external user body";
      }
    };
    await h.apply();
    expect(h.patches[0]?.expected_commit).toBe("external-winner");
    expect(h.documents.get(row.document_uri)?.body).toBe("external user body");
  });
  it("detects a target URI change during a conditional write", async () => {
    const first = relationRow("REEF-001", { depends_on: ["REEF-002"] }),
      second = relationRow("REEF-002"),
      h = harness([first, second]);
    let moved = false;
    h.controls.onPatch = () => {
      if (!moved) {
        moved = true;
        second.document_uri = "akb://reef-sample/coll/issues/doc/renamed.md";
        second.updated_at = "2026-02-01T00:00:00Z";
        const doc = h.documents.get(
          "akb://reef-sample/coll/issues/doc/reef-002.md",
        );
        if (!doc) throw Error("missing fixture");
        h.documents.set(second.document_uri, doc);
      }
    };
    await h.apply();
    expect(
      h.patches.filter((p) => p.uri === first.document_uri).at(-1)?.depends_on,
    ).toEqual([second.document_uri]);
  });
  it("detects a document head change while reading its graph", async () => {
    const row = relationRow(),
      h = harness([row]);
    await h.apply();
    h.controls.onGraphRead = () => {
      const doc = h.documents.get(row.document_uri);
      if (!doc) throw Error("missing fixture");
      doc.commit = "external";
    };
    await expect(h.verify()).rejects.toBeInstanceOf(ConflictError);
    expect(h.patches).toHaveLength(1);
  });
  it("waits for an obsolete implicit edge to disappear", async () => {
    const row = relationRow(),
      h = harness([row]);
    await h.apply();
    h.graph.set(row.document_uri, [
      {
        relation: "related_to",
        uri: "akb://reef-sample/coll/notes/doc/old.md",
        kind: "implicit",
      },
    ]);
    setTimeout(() => h.graph.set(row.document_uri, []), 15000);
    const result = h.verify().catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ count: 1 });
    expect(h.patches).toHaveLength(1);
  });
});
