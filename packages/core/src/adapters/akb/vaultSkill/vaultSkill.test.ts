import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../errors";
import {
  REEF_VAULT_SKILL_VERSION,
  buildReefVaultSkillDocuments,
  getVaultSkillStatus,
  hasReefVaultSkillDocuments,
  installReefVaultSkill,
} from "../index";
import { rootSkillContent } from "./content/rootSkill";
import {
  type FetchCall,
  type FetchResponseSpec,
  makeAdapter,
  setupFetch,
} from "../core/httpTestSupport";

function defaultRootGuide(vault: string): string {
  return readFileSync(
    new URL(
      "../../../../__tests__/fixtures/akb-default-root-guide.md",
      import.meta.url,
    ),
    "utf8",
  )
    .replace("{{vault}}", vault)
    .trimEnd();
}

function putResponse(path: string) {
  return {
    uri: `akb://reef-new/doc/${path}`,
    vault: "reef-new",
    path,
    commit_hash: "abc1234",
  };
}

function documentResponse(
  doc: ReturnType<typeof buildReefVaultSkillDocuments>[number],
  content = doc.content,
) {
  return {
    uri: `akb://reef-new/doc/${doc.path}`,
    vault: "reef-new",
    path: doc.path,
    title: doc.title,
    type: doc.type,
    status: "active",
    summary: doc.summary,
    tags: doc.tags,
    content,
  };
}

function bodyOf(
  call: FetchCall,
): Record<string, unknown> & { params?: unknown[]; sql?: string } {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown> & {
    params?: unknown[];
    sql?: string;
  };
}

/** Responses for the version stamp written after the managed documents land. */
function stampResponses(): FetchResponseSpec[] {
  return [
    { body: { kind: "table_sql", result: "DELETE 0" } },
    { body: { kind: "table_sql", result: "INSERT 0 1" } },
  ];
}

function statusQueryResponse(stored: unknown | null): FetchResponseSpec {
  return {
    body:
      stored === null
        ? { kind: "table_query", columns: ["value"], items: [], total: 0 }
        : {
            kind: "table_query",
            columns: ["value"],
            items: [{ value: JSON.stringify(stored) }],
            total: 1,
          },
  };
}

describe("installReefVaultSkill", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates managed documents before stamping the current skill version", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      ...docs.map((doc) => ({ body: putResponse(doc.path) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({ adapter: makeAdapter(), vault: "reef-new" });

    // 6 document upserts, then the version stamp (DELETE + INSERT).
    expect(calls).toHaveLength(8);
    expect(
      calls.slice(0, 6).every((call) => call.init?.method === "PATCH"),
    ).toBe(true);
    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/documents/reef-new/overview/vault-skill.md",
    );
    expect(bodyOf(calls[0])).toMatchObject({
      type: "skill",
      tags: ["akb:skill", "reef:pm-workspace"],
    });
    expect(calls[1].url).toBe(
      "https://akb.test/api/v1/documents/reef-new/reef/runbooks/pm-model.md",
    );
    expect(bodyOf(calls[1])).toMatchObject({
      type: "reference",
    });
    // The stamp runs last so a partial document failure leaves the old version.
    const del = calls[6];
    const insert = calls[7];
    expect(del.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
    expect(bodyOf(del)).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["vault_skill"],
    });
    expect(insert.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
    const insertBody = bodyOf(insert);
    expect(insertBody.sql).toBe(
      "INSERT INTO reef_settings (key, value) VALUES ($1, $2::json)",
    );
    expect(insertBody.params).toEqual([
      "vault_skill",
      expect.stringMatching(
        new RegExp(`\\"version\\":${REEF_VAULT_SKILL_VERSION}`),
      ),
    ]);
    expect(JSON.parse(String(insertBody.params?.[1]))).toMatchObject({
      version: REEF_VAULT_SKILL_VERSION,
    });
  });

  it("preserves existing skill documents during brownfield onboarding", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      { body: { kind: "table_sql", result: "DELETE 1" } },
      ...docs.map((doc) => ({ body: documentResponse(doc) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({
      adapter: makeAdapter(),
      vault: "reef-new",
      preserveExisting: true,
    });

    expect(calls).toHaveLength(9);
    expect(calls[0]?.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
    expect(calls.slice(1, 7).every((call) => call.init?.method === "GET")).toBe(
      true,
    );
    expect(calls[1]?.url).toBe(
      "https://akb.test/api/v1/documents/reef-new/overview/vault-skill.md",
    );
    expect(calls[7]?.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
  });

  it("adds Reef guidance to AKB's default Guide without replacing its root", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const rootPath = "overview/vault-skill.md";
    const longInteriorLineBreakRun = "\n".repeat(8_192);
    const stockContent = `${defaultRootGuide("reef-new")}${longInteriorLineBreakRun}Owner note after the blank run.`;
    const stockGuide = {
      uri: "akb://reef-new/coll/overview/doc/vault-skill.md",
      vault: "reef-new",
      path: rootPath,
      title: "reef-new Guide",
      type: "skill",
      status: "draft",
      summary:
        "> Edit this document to describe how agents should write into this vault.",
      tags: ["akb:skill"],
      content: stockContent,
      current_commit: "stock-guide-commit",
    };
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      const method = init?.method ?? "GET";
      const path = new URL(url).pathname;
      let response: unknown;

      if (path === "/api/v1/tables/reef-new/sql") {
        const sql = String(bodyOf(call).sql ?? "");
        response = {
          kind: "table_sql",
          result: sql.startsWith("DELETE") ? "DELETE 1" : "INSERT 0 1",
        };
      } else if (
        path === "/api/v1/documents/reef-new/overview/vault-skill.md" &&
        method === "GET"
      ) {
        response = stockGuide;
      } else if (
        path === "/api/v1/documents/reef-new/overview/vault-skill.md" &&
        method === "PATCH"
      ) {
        response = putResponse(rootPath);
      } else if (method === "GET") {
        const doc = docs.find(({ path: docPath }) =>
          path.endsWith(`/${docPath}`),
        );
        if (!doc) throw new Error(`Unexpected document request: ${url}`);
        response = documentResponse(doc);
      } else {
        throw new Error(`Unexpected AKB request: ${method} ${url}`);
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await installReefVaultSkill({
      adapter: makeAdapter(),
      vault: "reef-new",
      preserveExisting: true,
    });

    const rootPatch = calls.find(
      (call) =>
        call.url.endsWith(`/${rootPath}`) && call.init?.method === "PATCH",
    );
    if (!rootPatch) throw new Error("Expected the seeded Guide to be patched");
    const rootPatchBody = bodyOf(rootPatch);
    expect(rootPatchBody).toMatchObject({
      expected_commit: "stock-guide-commit",
      content: expect.stringContaining(stockContent),
    });
    expect(rootPatchBody.content).toContain(
      `${longInteriorLineBreakRun}Owner note after the blank run.`,
    );
    expect(rootPatchBody.content).toContain(
      "## Reef PM Workspace Instructions",
    );
    expect(rootPatchBody).not.toHaveProperty("title");
    expect(rootPatchBody).not.toHaveProperty("summary");
    expect(rootPatchBody).not.toHaveProperty("tags");
    expect(
      calls.filter((call) => call.url.includes("/tables/reef-new/sql")),
    ).toHaveLength(3);
  });

  it("does not stamp the current version over a preserved stale document", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      { body: { kind: "table_sql", result: "DELETE 1" } },
      ...docs.map((doc, index) => ({
        body: documentResponse(
          doc,
          index === 0 ? "OUTDATED MANUAL SKILL CONTENT" : doc.content,
        ),
      })),
      { body: { kind: "table_sql", result: "DELETE 1" } },
    ]);

    await installReefVaultSkill({
      adapter: makeAdapter(),
      vault: "reef-new",
      preserveExisting: true,
    });

    expect(calls).toHaveLength(docs.length + 1);
    expect(calls.slice(1).every((call) => call.init?.method === "GET")).toBe(
      true,
    );
    expect(bodyOf(calls[0])).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["vault_skill"],
    });
  });

  it("creates a document when PATCH returns 404", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      { status: 404, body: { detail: "missing" } },
      { body: putResponse(docs[0].path) },
      ...docs.slice(1).map((doc) => ({ body: putResponse(doc.path) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({ adapter: makeAdapter(), vault: "reef-new" });

    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[1].url).toBe("https://akb.test/api/v1/documents");
    expect(bodyOf(calls[1])).toMatchObject({
      vault: "reef-new",
      collection: "overview",
      slug: "vault-skill",
      type: "skill",
    });
  });

  it("retries PATCH when POST races with an existing document", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      { status: 404, body: { detail: "missing" } },
      { status: 409, body: { detail: "already exists" } },
      { body: putResponse(docs[0].path) },
      ...docs.slice(1).map((doc) => ({ body: putResponse(doc.path) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({ adapter: makeAdapter(), vault: "reef-new" });

    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[2].init?.method).toBe("PATCH");
    expect(calls[2].url).toBe(
      "https://akb.test/api/v1/documents/reef-new/overview/vault-skill.md",
    );
  });

  it("does not duplicate current Guide instructions when AKB trims the final newline", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const stockContent = defaultRootGuide("reef-new");
    const reefBody = rootSkillContent("reef-new")
      .replace(/^# [^\n]+\n+/, "")
      .replace(/\n+$/, "");
    const section = [
      "<!-- reef-pm-workspace:start -->",
      "## Reef PM Workspace Instructions",
      "",
      reefBody,
      "<!-- reef-pm-workspace:end -->",
    ].join("\n");
    const mergedContent = `${stockContent.replace(/\n+$/, "")}\n\n${section}\n`;
    const rootGuide = {
      uri: "akb://reef-new/coll/overview/doc/vault-skill.md",
      vault: "reef-new",
      path: "overview/vault-skill.md",
      title: "reef-new Guide",
      type: "skill",
      status: "draft",
      summary:
        "> Edit this document to describe how agents should write into this vault.",
      tags: ["akb:skill"],
      content: mergedContent.slice(0, -1),
      current_commit: "merged-guide-commit",
    };
    const { calls } = setupFetch([
      { body: { kind: "table_sql", result: "DELETE 1" } },
      { body: rootGuide },
      ...docs.slice(1).map((doc) => ({
        body: documentResponse(doc, doc.content.replace(/\n+$/, "")),
      })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({
      adapter: makeAdapter(),
      vault: "reef-new",
      preserveExisting: true,
    });

    expect(
      calls.filter(
        (call) =>
          call.url.endsWith("/overview/vault-skill.md") &&
          call.init?.method === "PATCH",
      ),
    ).toHaveLength(0);
    expect(calls).toHaveLength(9);
    expect(bodyOf(calls[7])).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["vault_skill"],
    });
    expect(bodyOf(calls[8])).toMatchObject({
      sql: "INSERT INTO reef_settings (key, value) VALUES ($1, $2::json)",
      params: [
        "vault_skill",
        expect.stringMatching(
          new RegExp(`\\"version\\":${REEF_VAULT_SKILL_VERSION}`),
        ),
      ],
    });
  });

  it("does not mark a Guide current when it also has a duplicate Reef section", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const reefBody = rootSkillContent("reef-new")
      .replace(/^# [^\n]+\n+/, "")
      .replace(/\n+$/, "");
    const managedSection = [
      "<!-- reef-pm-workspace:start -->",
      "## Reef PM Workspace Instructions",
      "",
      reefBody,
      "<!-- reef-pm-workspace:end -->",
    ].join("\n");
    const duplicatedGuide = `${defaultRootGuide("reef-new").trimEnd()}\n\n${managedSection}\n\n## Reef PM Workspace Instructions\n\nUser-maintained instructions.`;
    const rootGuide = {
      uri: "akb://reef-new/coll/overview/doc/vault-skill.md",
      vault: "reef-new",
      path: "overview/vault-skill.md",
      title: "reef-new Guide",
      type: "skill",
      status: "draft",
      summary:
        "> Edit this document to describe how agents should write into this vault.",
      tags: ["akb:skill"],
      content: duplicatedGuide,
      current_commit: "duplicate-guide-commit",
    };
    const { calls } = setupFetch([
      { body: { kind: "table_sql", result: "DELETE 1" } },
      { body: rootGuide },
      ...docs.slice(1).map((doc) => ({ body: documentResponse(doc) })),
      { body: { kind: "table_sql", result: "DELETE 1" } },
    ]);

    await installReefVaultSkill({
      adapter: makeAdapter(),
      vault: "reef-new",
      preserveExisting: true,
    });

    expect(
      calls.filter(
        (call) =>
          call.url.endsWith("/overview/vault-skill.md") &&
          call.init?.method === "PATCH",
      ),
    ).toHaveLength(0);
    expect(calls).toHaveLength(docs.length + 1);
    expect(
      calls.filter((call) => call.url.includes("/tables/reef-new/sql")),
    ).toHaveLength(1);
    const initialClear = calls[0];
    if (!initialClear) throw new Error("Expected the initial stamp clear");
    expect(bodyOf(initialClear)).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["vault_skill"],
    });
  });

  it("does not stamp over a Guide concurrently edited after its read", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const rootPath = "overview/vault-skill.md";
    const stockGuide = {
      uri: "akb://reef-new/coll/overview/doc/vault-skill.md",
      vault: "reef-new",
      path: rootPath,
      title: "reef-new Guide",
      type: "skill",
      status: "draft",
      summary:
        "> Edit this document to describe how agents should write into this vault.",
      tags: ["akb:skill"],
      content:
        "# reef-new Guide\n\n> Edit this document to describe how agents should write into this vault.\n> Until you do, it acts as the AKB-default template — agents fall back to\n> general AKB conventions (browse before write, no inline secrets, etc.).\n",
      current_commit: "read-guide-commit",
    };
    const { calls } = setupFetch([
      { body: { kind: "table_sql", result: "DELETE 1" } },
      { body: stockGuide },
      { status: 409, body: { detail: "document commit has changed" } },
    ]);

    await expect(
      installReefVaultSkill({
        adapter: makeAdapter(),
        vault: "reef-new",
        preserveExisting: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const attemptedPatch = calls[2];
    if (!attemptedPatch) throw new Error("Expected the OCC-protected patch");
    expect(bodyOf(attemptedPatch)).toMatchObject({
      expected_commit: "read-guide-commit",
      content: expect.stringContaining("AKB-default template"),
    });
    expect(calls).toHaveLength(3);
  });

  it("preserves a Guide created after onboarding reads a missing document", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const rootPath = "overview/vault-skill.md";
    const ownerContent = "# Owner policy\n\nKeep customer data private.";
    const ownerGuide = {
      ...documentResponse(docs[0], ownerContent),
      title: "Owner Guide",
      summary: "Owner policy",
      tags: ["akb:skill", "policy:owner"],
      current_commit: "owner-created-commit",
    };
    let rootGuide: typeof ownerGuide | null = null;
    let readMissing = false;
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const call = { url, init };
        calls.push(call);
        const method = init?.method ?? "GET";
        const path = new URL(url).pathname;
        let status = 200;
        let payload: unknown;
        if (path === "/api/v1/tables/reef-new/sql") {
          payload = { kind: "table_sql", result: "DELETE 0" };
        } else if (path.endsWith(`/${rootPath}`) && method === "GET") {
          if (!readMissing) {
            readMissing = true;
            rootGuide = { ...ownerGuide };
            status = 404;
            payload = { detail: "missing" };
          } else {
            payload = rootGuide;
          }
        } else if (path.endsWith(`/${rootPath}`) && method === "PATCH") {
          rootGuide = { ...ownerGuide, ...bodyOf(call) };
          payload = putResponse(rootPath);
        } else if (path === "/api/v1/documents" && method === "POST") {
          status = 409;
          payload = { detail: "already exists" };
        } else if (method === "GET") {
          const doc = docs.find(({ path: docPath }) =>
            path.endsWith(`/${docPath}`),
          );
          if (!doc) throw new Error(`Unexpected document request: ${url}`);
          payload = documentResponse(doc);
        } else {
          throw new Error(`Unexpected AKB request: ${method} ${url}`);
        }
        return new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(
      installReefVaultSkill({
        adapter: makeAdapter(),
        vault: "reef-new",
        preserveExisting: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(rootGuide).toEqual(ownerGuide);
    expect(calls).toHaveLength(3);
    expect(calls.some((call) => call.init?.method === "PATCH")).toBe(false);
    expect(
      calls
        .filter((call) => call.url.includes("/tables/reef-new/sql"))
        .some((call) => String(bodyOf(call).sql).startsWith("INSERT")),
    ).toBe(false);
  });
});

describe("getVaultSkillStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports up to date when the stamp matches the current version", async () => {
    const { calls } = setupFetch([
      statusQueryResponse({
        version: REEF_VAULT_SKILL_VERSION,
        synced_at: "2026-06-09T00:00:00.000Z",
      }),
    ]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    expect(status).toEqual({
      installed_version: REEF_VAULT_SKILL_VERSION,
      current_version: REEF_VAULT_SKILL_VERSION,
      up_to_date: true,
      synced_at: "2026-06-09T00:00:00.000Z",
    });
    expect(bodyOf(calls[0])).toEqual({
      sql: "SELECT value FROM reef_settings WHERE key = $1 LIMIT 1",
      params: ["vault_skill"],
    });
  });

  it("reports not up to date when the stamped version is older", async () => {
    setupFetch([
      statusQueryResponse({
        version: REEF_VAULT_SKILL_VERSION - 1,
        synced_at: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    expect(status.installed_version).toBe(REEF_VAULT_SKILL_VERSION - 1);
    expect(status.up_to_date).toBe(false);
  });

  it("treats a newer stamped version as up to date so it is never downgraded", async () => {
    setupFetch([
      statusQueryResponse({
        version: REEF_VAULT_SKILL_VERSION + 1,
        synced_at: "2026-12-31T00:00:00.000Z",
      }),
    ]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    // A mixed-version rollout / revert should not present this older release as
    // an "available update" that would overwrite the newer docs.
    expect(status.installed_version).toBe(REEF_VAULT_SKILL_VERSION + 1);
    expect(status.up_to_date).toBe(true);
  });

  it("treats a never-stamped vault as not up to date (older)", async () => {
    setupFetch([statusQueryResponse(null)]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    expect(status).toMatchObject({
      installed_version: null,
      up_to_date: false,
      synced_at: null,
    });
  });

  it("treats a vault with no reef tables as not up to date", async () => {
    setupFetch([
      {
        body: { error: 'relation "vt_reef-new__reef_settings" does not exist' },
      },
    ]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    expect(status.installed_version).toBeNull();
    expect(status.up_to_date).toBe(false);
  });

  it("ignores a corrupt stored value", async () => {
    setupFetch([statusQueryResponse({ version: "not-a-number" })]);

    const status = await getVaultSkillStatus({
      adapter: makeAdapter(),
      vault: "reef-new",
    });

    expect(status.installed_version).toBeNull();
  });
});

describe("hasReefVaultSkillDocuments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts existing user-customized skill documents without reading the version stamp", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch(
      docs.map((doc) => ({ body: documentResponse(doc, "USER CUSTOMIZED") })),
    );

    await expect(
      hasReefVaultSkillDocuments({ adapter: makeAdapter(), vault: "reef-new" }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(docs.length);
    expect(calls.every(({ init }) => init?.method === "GET")).toBe(true);
    expect(calls.some(({ url }) => url.includes("/tables/"))).toBe(false);
  });

  it("returns false when a managed skill document is missing", async () => {
    const [first, second] = buildReefVaultSkillDocuments("reef-new");
    const { calls } = setupFetch([
      { body: documentResponse(first) },
      { status: 404, body: { detail: "missing" } },
    ]);

    await expect(
      hasReefVaultSkillDocuments({ adapter: makeAdapter(), vault: "reef-new" }),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain(second.path);
  });

  it("propagates upstream failures instead of treating them as missing setup", async () => {
    setupFetch([{ status: 503, body: { detail: "unavailable" } }]);

    await expect(
      hasReefVaultSkillDocuments({ adapter: makeAdapter(), vault: "reef-new" }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
