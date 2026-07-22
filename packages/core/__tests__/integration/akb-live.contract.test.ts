import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AkbAdapter,
  akbReconcileWorkspaceSchema,
  buildIssueMetadataFromCreateInput,
  createAkbAdapter,
  createVault,
  login,
  readIssue,
  searchDocuments,
  writeIssue,
} from "../../src/adapters/akb";
import {
  AkbSearchResponseSchema,
  AkbSqlMutationResponseSchema,
  AkbSqlQueryResponseSchema,
  AkbSqlResponseSchema,
  DocumentPutResponseSchema,
  DocumentResponseSchema,
  runSql,
} from "../../src/adapters/akb/core/shared";

/**
 * REEF-056 — live akb contract smoke (parent REEF-084).
 *
 * The static REEF-050 suite pins reef's hand-mirrored Zod envelopes against
 * CAPTURED akb responses; a capture freezes the wire shape at capture time, so
 * a redeployed akb that renames/adds a key drifts undetected. This suite
 * re-applies the SAME mirrors to LIVE responses from a running akb
 * (docker-compose), through reef's real adapter fetch path, so backend drift
 * fails here at the integration level instead of in production (REEF-049 class).
 *
 * Hermetic by design — OFF unless REEF_LIVE_AKB_URL points at a reachable akb.
 * The default `pnpm --filter @reef/core test` does NOT include
 * `__tests__/integration/**` (vitest `include` is `src/**`); this file runs only
 * via the dedicated `test:live-akb` script, on a protected-branch-only CI job.
 * So it is never part of the always-green unit signal.
 *
 * Surfaces covered (the envelopes reef-web's fetch path actually receives):
 *   document put + get, search, sql (table_query + table_sql).
 * Provenance (`GET /provenance`) is intentionally OUT of scope: reef's fetch
 * path never calls it and reef mirrors no provenance envelope, so there is no
 * reef contract to pin. Adding one would test akb, not reef's contract.
 */

const BASE_URL = process.env.REEF_LIVE_AKB_URL;
const USERNAME = process.env.REEF_LIVE_AKB_USER ?? "reef-smoke";
const PASSWORD = process.env.REEF_LIVE_AKB_PW ?? "reef-smoke-pw-123";
const EMAIL = process.env.REEF_LIVE_AKB_EMAIL ?? "reef-smoke@example.com";

const SEED_ISSUE_ID = "REEF-001";
const SEED_DOC_PATH = "issues/reef-001.md";

/** akb keys absent from a strip-mode mirror's declared shape (mirrors REEF-050). */
function strippedKeys(
  raw: Record<string, unknown>,
  known: Iterable<string>,
): string[] {
  const declared = new Set(known);
  return Object.keys(raw)
    .filter((key) => !declared.has(key))
    .sort();
}

/**
 * Ensure a login-able seed user exists. akb grants admin to the FIRST registered
 * user, so a fresh compose needs this once; on a re-run the duplicate register
 * is a 4xx we swallow before logging in. login()'s own errors surface real
 * connectivity/credential problems.
 */
async function ensureSeedUser(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: USERNAME,
        email: EMAIL,
        password: PASSWORD,
        display_name: "Reef Live Smoke",
      }),
    });
  } catch {
    // Swallow — a duplicate-user 4xx is expected on re-runs, and a genuine
    // network failure resurfaces from login() below with a clearer message.
  }
}

describe.skipIf(!BASE_URL)("akb live contract smoke (REEF-056)", () => {
  const baseUrl = BASE_URL as string;
  let adapter: AkbAdapter;
  let vault: string;

  beforeAll(async () => {
    await ensureSeedUser(baseUrl);
    const { token } = await login({
      baseUrl,
      username: USERNAME,
      password: PASSWORD,
    });
    adapter = createAkbAdapter({ baseUrl, jwt: token });

    // Throwaway vault per run so local re-runs never collide; teardown below.
    vault = `reef-live-smoke-${Date.now()}`;
    await createVault({
      adapter,
      name: vault,
      description: "REEF-056 live contract smoke (throwaway)",
    });
    await akbReconcileWorkspaceSchema({ adapter, vault });

    // Seed one issue through reef's REAL write path (doc PUT + reef_issues row).
    const issue = buildIssueMetadataFromCreateInput({
      id: SEED_ISSUE_ID,
      create: { fields: { title: "Live contract smoke seed" } },
      author: USERNAME,
    });
    await writeIssue({
      adapter,
      vault,
      issue,
      content: "Seed body for the REEF-056 live contract smoke.",
    });
  }, 60_000);

  afterAll(async () => {
    if (adapter && vault) {
      // Best-effort teardown; CI's akb is ephemeral, local re-runs use unique names.
      await adapter
        .request(`/api/v1/vaults/${encodeURIComponent(vault)}`, {
          method: "DELETE",
          resource: `vault ${vault}`,
        })
        .catch(() => {});
    }
  });

  it("document GET — live envelope parses and akb-internal keys are stripped", async () => {
    const raw = (await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${SEED_DOC_PATH}`,
      { resource: `document ${SEED_ISSUE_ID}` },
    )) as Record<string, unknown>;

    // akb sends these on every document GET; reef does not mirror them.
    expect(raw).toHaveProperty("content_hash");
    expect(raw).toHaveProperty("metadata_is_current");

    const parsed = DocumentResponseSchema.parse(raw) as Record<string, unknown>;
    expect(parsed.uri).toBe(raw.uri);
    // Strip mode drops them, and we pin the dropped set so an akb-side ADD
    // breaks here and forces a conscious mirror update (REEF-050 axis 2).
    expect(parsed).not.toHaveProperty("content_hash");
    // Pinned to LIVE akb 0.1.0 reality: `created_by_name` joined the document
    // envelope after the REEF-050 capture (2026-06-04) without an akb version
    // bump — exactly the within-version drift this smoke exists to surface.
    expect(
      strippedKeys(raw, Object.keys(DocumentResponseSchema.shape)),
    ).toEqual([
      "content_hash",
      "created_by_name",
      "hash_algorithm",
      "metadata_is_current",
    ]);
  });

  it("document PUT — live envelope parses and stripped key set holds", async () => {
    const raw = (await adapter.request("/api/v1/documents", {
      method: "POST",
      body: {
        vault,
        collection: "issues",
        title: SEED_ISSUE_ID,
        content: "Re-put body for the PUT envelope contract.",
        type: "task",
        status: "active",
        summary: "Live contract smoke seed",
        tags: [],
        depends_on: [],
        related_to: [],
      },
      resource: `document ${SEED_ISSUE_ID}`,
    })) as Record<string, unknown>;

    const parsed = DocumentPutResponseSchema.parse(raw);
    expect(parsed.commit_hash).toEqual(expect.any(String));
    expect(
      strippedKeys(raw, Object.keys(DocumentPutResponseSchema.shape)),
    ).toEqual([
      "action",
      "content_hash",
      "current_commit",
      "hash_algorithm",
      "previous_commit",
      "previous_content_hash",
    ]);
  });

  it("search — live envelope parses and passthrough keeps akb-only fields", async () => {
    // Raw envelope: akb keys the array `results`; the mirror is `.passthrough()`
    // so richer akb fields (total_matches, returned, truncated) survive verbatim.
    const raw = (await adapter.request("/api/v1/search", {
      query: { vault, q: "smoke", limit: 5 },
      resource: `search ${vault}`,
    })) as Record<string, unknown>;
    const parsed = AkbSearchResponseSchema.parse(raw) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(parsed.results ?? parsed.items)).toBe(true);
    expect(parsed).toHaveProperty("total_matches");

    // reef's real search path parses each hit; a hit-shape drift throws here.
    const hits = await searchDocuments({
      adapter,
      vault,
      query: "smoke",
      limit: 5,
    });
    expect(Array.isArray(hits)).toBe(true);
  });

  it("sql — live table_query and table_sql parse through the discriminated union", async () => {
    const rawQuery = (await adapter.request(
      `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
      {
        method: "POST",
        body: { sql: "SELECT reef_id, status FROM reef_issues" },
        resource: `sql ${vault}`,
      },
    )) as Record<string, unknown>;
    const query = AkbSqlResponseSchema.parse(rawQuery);
    expect(query.kind).toBe("table_query");
    if (query.kind === "table_query") {
      expect(query.columns).toContain("reef_id");
    }
    expect(
      strippedKeys(rawQuery, Object.keys(AkbSqlQueryResponseSchema.shape)),
    ).toEqual([]);

    const rawMutation = (await adapter.request(
      `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
      {
        method: "POST",
        body: {
          sql: `UPDATE reef_issues SET status = status WHERE reef_id = '${SEED_ISSUE_ID}'`,
        },
        resource: `sql ${vault}`,
      },
    )) as Record<string, unknown>;
    const mutation = AkbSqlResponseSchema.parse(rawMutation);
    expect(mutation.kind).toBe("table_sql");
    if (mutation.kind === "table_sql") {
      expect(mutation.result).toMatch(/^UPDATE/);
    }
    expect(
      strippedKeys(
        rawMutation,
        Object.keys(AkbSqlMutationResponseSchema.shape),
      ),
    ).toEqual([]);

    // reef's real SQL path (runSql) parses the same envelopes; drift throws.
    const viaRunSql = await runSql(
      adapter,
      vault,
      "SELECT reef_id FROM reef_issues",
    );
    expect(viaRunSql.kind).toBe("table_query");
  });

  it("readIssue — reef's joined read path parses a live document + row", async () => {
    const result = await readIssue({ adapter, vault, id: SEED_ISSUE_ID });
    expect(result.issue.id).toBe(SEED_ISSUE_ID);
  });
});
