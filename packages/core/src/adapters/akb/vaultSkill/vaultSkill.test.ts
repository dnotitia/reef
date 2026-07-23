import { afterEach, describe, expect, it, vi } from "vitest";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import {
  REEF_VAULT_SKILL_VERSION,
  buildReefVaultSkillDocuments,
  createAkbAdapter,
  getVaultSkillStatus,
  installReefVaultSkill,
} from "../index";

mockOpenTelemetry();

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchResponseSpec {
  status?: number;
  body?: unknown;
}

function putResponse(path: string) {
  return {
    uri: `akb://reef-new/doc/${path}`,
    vault: "reef-new",
    path,
    commit_hash: "abc1234",
  };
}

function setupFetch(responses: FetchResponseSpec[]): FetchCall[] {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error(`No mocked response for ${url}`);
    }
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function makeAdapter() {
  return createAkbAdapter({
    baseUrl: "https://akb.test",
    jwt: "jwt.example.token",
  });
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

const ALL_REEF_TABLES = [
  "reef_settings",
  "monitored_repos",
  "reef_issues",
  "reef_sprints",
  "reef_milestones",
  "reef_releases",
  "reef_templates",
  "reef_views",
  "reef_activity_suggestions",
  "reef_comments",
  "reef_attachments",
  "reef_activity",
];

/**
 * Responses for the version stamp that `installReefVaultSkill` now performs
 * after the documents land: `ensureReefTables` lists tables (all present here,
 * so zero creates), then a DELETE + INSERT on `reef_settings`.
 */
function stampResponses(): FetchResponseSpec[] {
  return [
    {
      body: {
        kind: "table",
        vault: "reef-new",
        items: ALL_REEF_TABLES.map((name) => ({ name })),
      },
    },
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

  it("patches the root skill and runbook documents idempotently", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const calls = setupFetch([
      ...docs.map((doc) => ({ body: putResponse(doc.path) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({ adapter: makeAdapter(), vault: "reef-new" });

    // 8 document upserts, then the version stamp (listTables + DELETE + INSERT).
    expect(calls).toHaveLength(11);
    expect(
      calls.slice(0, 8).every((call) => call.init?.method === "PATCH"),
    ).toBe(true);
    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/documents/reef-new/overview/vault-skill.md",
    );
    expect(bodyOf(calls[0])).toMatchObject({
      type: "skill",
      tags: ["akb:skill", "reef:pm-workspace"],
    });
  });

  it("stamps the current skill version after the documents land", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const calls = setupFetch([
      ...docs.map((doc) => ({ body: putResponse(doc.path) })),
      ...stampResponses(),
    ]);

    await installReefVaultSkill({ adapter: makeAdapter(), vault: "reef-new" });

    // The stamp runs last so a partial document failure leaves the old version.
    const listTables = calls[8];
    const del = calls[9];
    const insert = calls[10];
    expect(listTables.url).toBe("https://akb.test/api/v1/tables/reef-new");
    expect(del.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
    expect(String(bodyOf(del).sql)).toContain("DELETE FROM reef_settings");
    expect(insert.url).toBe("https://akb.test/api/v1/tables/reef-new/sql");
    const insertSql = String(bodyOf(insert).sql);
    expect(insertSql).toContain("INSERT INTO reef_settings");
    expect(insertSql).toContain("'vault_skill'");
    expect(insertSql).toContain(`"version":${REEF_VAULT_SKILL_VERSION}`);
  });

  it("creates a document when PATCH returns 404", async () => {
    const docs = buildReefVaultSkillDocuments("reef-new");
    const calls = setupFetch([
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
    const calls = setupFetch([
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
});

describe("getVaultSkillStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports up to date when the stamp matches the current version", async () => {
    setupFetch([
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
