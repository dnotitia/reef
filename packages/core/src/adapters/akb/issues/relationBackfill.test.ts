import { describe, expect, it, vi } from "vitest";
import {
  makeDocumentResponse,
  makePutResponse,
  makeSqlQueryResponse,
  setupFetch,
} from "../core/akb.testSupport";
import {
  backfillIssueRelationUris,
  preflightIssueRelationUris,
} from "./relationBackfill";

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

describe("issue relation backfill", () => {
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
  it("rejects a missing target before writing any documents", async () => {
    const { calls } = setupFetch([
      { body: VAULT_INFO },
      { body: VAULT_ACTOR },
      {
        body: makeSqlQueryResponse(
          [
            {
              reef_id: "REEF-001",
              document_uri: "akb://reef-sample/doc/a.md",
              depends_on: ["REEF-002"],
              related_to: [],
              blocks: [],
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
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
    ).rejects.toThrow();
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
  });
  it("rejects a missing backing document before any patch", async () => {
    const row = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/missing.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const { calls } = setupFetch([
      { body: VAULT_INFO },
      { body: VAULT_ACTOR },
      { body: makeSqlQueryResponse([row], Object.keys(row)) },
      { status: 404, body: { detail: "missing" } },
    ]);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).rejects.toThrow();
    expect(calls.every((call) => call.init?.method !== "PATCH")).toBe(true);
  });
  it("patches empty relationships and verifies outgoing graph", async () => {
    const row = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const query = makeSqlQueryResponse([row], Object.keys(row));
    const document = {
      ...makeDocumentResponse(),
      uri: row.document_uri,
      current_commit: "old",
    };
    const { calls } = setupFetch([
      { body: VAULT_INFO },
      { body: VAULT_ACTOR },
      { body: query },
      { body: document },
      { body: query },
      { body: query },
      { body: document },
      { body: makePutResponse() },
      { body: query },
      { body: { uri: row.document_uri, relations: [] } },
      { body: { uri: row.document_uri, relations: [] } },
      { body: query },
    ]);
    await expect(
      backfillIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 1 });
    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      depends_on: [],
      related_to: [],
      expected_commit: "old",
      message: "Backfill issue relation URIs",
    });
    expect(
      calls.some((call) => String(call.init?.body).includes("reef_id IN")),
    ).toBe(true);
  });
  it("restarts the vault pass when an issue appears during a patch", async () => {
    const first = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const second = {
      ...first,
      reef_id: "REEF-002",
      document_uri: "akb://reef-sample/doc/b.md",
    };
    let inserted = false;
    const patched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const address = new URL(url);
        let body: unknown;
        if (address.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (address.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (address.pathname.includes("/tables/")) {
          const query = JSON.parse(String(init?.body));
          const rows = inserted ? [first, second] : [first];
          body = makeSqlQueryResponse(
            query.sql.includes(" IN ")
              ? rows.filter((row) => query.params.includes(row.reef_id))
              : rows,
            Object.keys(first),
          );
        } else if (address.pathname.endsWith("/relations"))
          body = { uri: address.searchParams.get("uri"), relations: [] };
        else if (init?.method === "PATCH") {
          patched.push(address.pathname);
          inserted = true;
          body = makePutResponse();
        } else {
          const uri = address.pathname.endsWith("b.md")
            ? second.document_uri
            : first.document_uri;
          body = { ...makeDocumentResponse(), uri, current_commit: "head" };
        }
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await backfillIssueRelationUris({
      ...BACKFILL_CONFIG,
      vault: "reef-sample",
    });
    expect(patched).toContain("/api/v1/documents/reef-sample/b.md");
  });

  it("retries when a source row changes during graph verification", async () => {
    const row = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    let changed = false;
    let patches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        let body: unknown;
        if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (parsed.pathname.includes("/tables/"))
          body = makeSqlQueryResponse(
            [
              {
                ...row,
                updated_at: changed ? "2026-01-02T00:00:00Z" : row.updated_at,
              },
            ],
            Object.keys(row),
          );
        else if (parsed.pathname.endsWith("/relations")) {
          changed = true;
          body = { uri: row.document_uri, relations: [] };
        } else if (init?.method === "PATCH") {
          patches++;
          body = makePutResponse();
        } else
          body = {
            ...makeDocumentResponse(),
            uri: row.document_uri,
            current_commit: "head",
          };
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(
      backfillIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 1 });
    expect(patches).toBe(2);
  });

  it("converges after a later document fails and the vault is retried", async () => {
    const rows = ["a", "b"].map((name, index) => ({
      reef_id: `REEF-00${index + 1}`,
      document_uri: `akb://reef-sample/doc/${name}.md`,
      depends_on: index === 0 ? ["REEF-002"] : [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    }));
    const patches: string[] = [];
    let failSecond = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        let body: unknown;
        if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (parsed.pathname.includes("/tables/")) {
          const query = JSON.parse(String(init?.body));
          body = makeSqlQueryResponse(
            query.sql.includes(" IN ")
              ? rows.filter((row) => query.params.includes(row.reef_id))
              : rows,
            Object.keys(rows[0]),
          );
        } else if (parsed.pathname.endsWith("/relations")) {
          const uri = parsed.searchParams.get("uri");
          body = {
            uri,
            relations:
              uri === rows[0].document_uri &&
              parsed.searchParams.get("type") === "depends_on"
                ? [
                    {
                      relation: "depends_on",
                      uri: rows[1].document_uri,
                      kind: "implicit",
                    },
                  ]
                : [],
          };
        } else if (init?.method === "PATCH") {
          patches.push(parsed.pathname);
          expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual([
            "depends_on",
            "expected_commit",
            "message",
            "related_to",
          ]);
          if (parsed.pathname.endsWith("b.md") && failSecond)
            return Response.json({ detail: "interrupted" }, { status: 500 });
          body = makePutResponse();
        } else {
          const uri = parsed.pathname.endsWith("b.md")
            ? rows[1].document_uri
            : rows[0].document_uri;
          body = { ...makeDocumentResponse(), uri, current_commit: "head" };
        }
        return Response.json(body);
      }),
    );
    await expect(
      backfillIssueRelationUris({ ...BACKFILL_CONFIG, vault: "reef-sample" }),
    ).rejects.toThrow();
    failSecond = false;
    await expect(
      backfillIssueRelationUris({ ...BACKFILL_CONFIG, vault: "reef-sample" }),
    ).resolves.toEqual({ count: 2 });
    expect(patches).toEqual([
      "/api/v1/documents/reef-sample/a.md",
      "/api/v1/documents/reef-sample/b.md",
      "/api/v1/documents/reef-sample/a.md",
      "/api/v1/documents/reef-sample/b.md",
    ]);
  });

  it("fails after bounded retries when the source keeps changing", async () => {
    const row = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        let body: unknown;
        if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (parsed.pathname.includes("/tables/")) {
          const query = JSON.parse(String(init?.body));
          body = makeSqlQueryResponse(
            [
              {
                ...row,
                updated_at: query.sql.includes(" IN ")
                  ? "2026-01-02T00:00:00Z"
                  : row.updated_at,
              },
            ],
            Object.keys(row),
          );
          if (query.sql.includes(" IN ")) attempts++;
        } else
          body = {
            ...makeDocumentResponse(),
            uri: row.document_uri,
            current_commit: "head",
          };
        return Response.json(body);
      }),
    );
    await expect(
      backfillIssueRelationUris({ ...BACKFILL_CONFIG, vault: "reef-sample" }),
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });
  it("checks relationships beyond the first page before any document write", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      reef_id: `REEF-${String(index + 1).padStart(3, "0")}`,
      document_uri: `akb://reef-sample/doc/item-${index}.md`,
      depends_on: index === 200 ? ["REEF-999"] : [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    }));
    const queries: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.includes("/vaults/"))
        return Response.json(VAULT_INFO);
      if (new URL(url).pathname.endsWith("/auth/me"))
        return Response.json(VAULT_ACTOR);
      const request = JSON.parse(String(init?.body));
      queries.push(request.sql);
      const page = rows
        .filter((row) => row.reef_id > request.params[0])
        .slice(0, request.params[1]);
      return new Response(
        JSON.stringify(makeSqlQueryResponse(page, Object.keys(rows[0]))),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(queries.every((sql) => !sql.includes("archived_at"))).toBe(true);
  });

  it("preflights every page including archived issue documents", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      reef_id: `REEF-${String(index + 1).padStart(3, "0")}`,
      document_uri: `akb://reef-sample/doc/item-${index}.md`,
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    }));
    const documentReads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        let body: unknown;
        if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (parsed.pathname.includes("/tables/")) {
          const request = JSON.parse(String(init?.body));
          body = makeSqlQueryResponse(
            rows
              .filter((row) => row.reef_id > request.params[0])
              .slice(0, request.params[1]),
            Object.keys(rows[0]),
          );
        } else {
          const uri = `akb://reef-sample/doc/${parsed.pathname.split("/").at(-1)}`;
          documentReads.push(uri);
          body = {
            ...makeDocumentResponse(),
            uri,
            current_commit: "head",
            status: uri.endsWith("item-200.md") ? "archived" : "active",
          };
        }
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(
      preflightIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 201 });
    expect(documentReads).toContain("akb://reef-sample/doc/item-200.md");
  });

  it("waits for stale implicit relationships to disappear before returning", async () => {
    const row = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: [],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const query = makeSqlQueryResponse([row], Object.keys(row));
    const document = {
      ...makeDocumentResponse(),
      uri: row.document_uri,
      current_commit: "old",
    };
    const empty = { uri: row.document_uri, relations: [] };
    setupFetch([
      { body: VAULT_INFO },
      { body: VAULT_ACTOR },
      { body: query },
      { body: document },
      { body: query },
      { body: query },
      { body: document },
      { body: makePutResponse() },
      { body: query },
      {
        body: {
          uri: row.document_uri,
          relations: [
            {
              direction: "outgoing",
              relation: "depends_on",
              uri: "akb://reef-sample/doc/old.md",
              kind: "implicit",
            },
          ],
        },
      },
      { body: empty },
      { body: query },
      { body: empty },
      { body: empty },
      { body: query },
    ]);
    let finished = false;
    const work = backfillIssueRelationUris({
      ...BACKFILL_CONFIG,
      vault: "reef-sample",
    }).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(finished).toBe(false);
    await expect(work).resolves.toEqual({ count: 1 });
  });

  it("accepts an expected explicit edge and leaves unrelated explicit edges alone", async () => {
    const first = {
      reef_id: "REEF-001",
      document_uri: "akb://reef-sample/doc/a.md",
      depends_on: ["REEF-002"],
      related_to: [],
      blocks: [],
      updated_at: "2026-01-01T00:00:00Z",
    };
    const second = {
      ...first,
      reef_id: "REEF-002",
      document_uri: "akb://reef-sample/doc/b.md",
      depends_on: [],
    };
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        const method = init?.method ?? "GET";
        methods.push(method);
        let body: unknown;
        if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
        else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
        else if (parsed.pathname.includes("/tables/")) {
          const query = JSON.parse(String(init?.body));
          const rows = [first, second];
          body = makeSqlQueryResponse(
            query.sql.includes(" IN ")
              ? rows.filter((row) => query.params.includes(row.reef_id))
              : rows,
            Object.keys(first),
          );
        } else if (parsed.pathname.endsWith("/relations")) {
          const uri = parsed.searchParams.get("uri");
          const edges =
            uri === first.document_uri &&
            parsed.searchParams.get("type") === "depends_on"
              ? [
                  {
                    direction: "outgoing",
                    relation: "depends_on",
                    uri: second.document_uri,
                    kind: "explicit",
                  },
                  {
                    direction: "outgoing",
                    relation: "depends_on",
                    uri: "akb://reef-sample/doc/other.md",
                    kind: "explicit",
                  },
                ]
              : [];
          body = { uri, relations: edges };
        } else if (method === "PATCH") body = makePutResponse();
        else {
          const uri = parsed.pathname.endsWith("b.md")
            ? second.document_uri
            : first.document_uri;
          body = { ...makeDocumentResponse(), uri, current_commit: "head" };
        }
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await expect(
      backfillIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }),
    ).resolves.toEqual({ count: 2 });
    expect(methods).not.toContain("DELETE");
  });

  it("fails when the public graph never converges", async () => {
    vi.useFakeTimers();
    try {
      const row = {
        reef_id: "REEF-001",
        document_uri: "akb://reef-sample/doc/a.md",
        depends_on: [],
        related_to: [],
        blocks: [],
        updated_at: "2026-01-01T00:00:00Z",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const parsed = new URL(url);
          let body: unknown;
          if (parsed.pathname.includes("/vaults/")) body = VAULT_INFO;
          else if (parsed.pathname.endsWith("/auth/me")) body = VAULT_ACTOR;
          else if (parsed.pathname.includes("/tables/"))
            body = makeSqlQueryResponse([row], Object.keys(row));
          else if (parsed.pathname.endsWith("/relations"))
            body = {
              uri: row.document_uri,
              relations: [
                {
                  uri: "akb://reef-sample/doc/stale.md",
                  relation: "depends_on",
                  direction: "outgoing",
                  kind: "implicit",
                },
              ],
            };
          else if (init?.method === "PATCH") body = makePutResponse();
          else
            body = {
              ...makeDocumentResponse(),
              uri: row.document_uri,
              current_commit: "head",
            };
          return new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          });
        }),
      );
      const outcome = backfillIssueRelationUris({
        ...BACKFILL_CONFIG,
        vault: "reef-sample",
      }).then(
        () => null,
        (error) => error,
      );
      await vi.runAllTimersAsync();
      expect(await outcome).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
