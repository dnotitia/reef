import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AkbAdapter,
  buildIssueMetadataFromCreateInput,
  createAkbAdapter,
  createVault,
  ensureReefTables,
  login,
  listIssueBodyHistory,
  readIssue,
  searchDocuments,
  updateIssue,
  writeIssue,
} from "../../src/adapters/akb";
import {
  deleteAkbFile,
  downloadAkbFile,
  uploadAkbFile,
} from "../../src/adapters/akb/core/files";
import {
  getResourceRelations,
  linkResources,
  unlinkResources,
} from "../../src/adapters/akb/core/relations";
import {
  AkbSearchResponseSchema,
  AkbSqlMutationResponseSchema,
  AkbSqlQueryResponseSchema,
  AkbSqlResponseSchema,
  DocumentPutResponseSchema,
  DocumentResponseSchema,
  runSql,
} from "../../src/adapters/akb/core/shared";
import {
  REEF_DESIRED_TABLES,
  REEF_NOTIFICATIONS_TABLE,
  REEF_SCHEMA_VERSION,
  REEF_SUBSCRIPTIONS_TABLE,
  akbCreateNotification,
  akbGetEffectiveSubscriptionState,
  akbListNotifications,
  akbListSubscriptions,
  akbMuteIssue,
  akbRemoveSubscription,
  akbUpdateNotificationState,
  akbUpsertSubscription,
  akbWatchIssue,
} from "../../src/index";

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
 *   document put + get, search, sql (table_query + table_sql), files, resource
 *   relations, and issue body history.
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

interface TemporaryDocument {
  uri: string;
  path: string;
}

async function createTemporaryRelationDocument(
  adapter: AkbAdapter,
  vault: string,
  title: string,
): Promise<TemporaryDocument> {
  const raw = await adapter.request("/api/v1/documents", {
    method: "POST",
    body: {
      vault,
      collection: "contract-resources",
      title,
      content: "Temporary relation resource for the live contract.",
      type: "note",
      status: "active",
      summary: title,
      tags: [],
    },
    resource: "temporary relation document",
  });
  const document = DocumentPutResponseSchema.parse(raw);
  return { uri: document.uri, path: document.path };
}

async function deleteTemporaryDocument(
  adapter: AkbAdapter,
  vault: string,
  path: string,
): Promise<void> {
  await adapter.request(
    `/api/v1/documents/${encodeURIComponent(vault)}/${path}`,
    {
      method: "DELETE",
      resource: "temporary relation document",
    },
  );
}

interface FileRequestObservation {
  surface: "akb" | "presigned";
  hasAuthorization: boolean;
  stage: string;
}

function installFileFetchObserver(options: { failUpload?: boolean } = {}): {
  observations: FileRequestObservation[];
  restore: () => void;
} {
  const observations: FileRequestObservation[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = new Request(input, init);
    const method = request.method;
    const url = new URL(request.url);
    const isAkb = method !== "PUT" && url.pathname.startsWith("/api/v1/");
    const stage =
      method === "PUT"
        ? "transfer_upload"
        : method === "POST" && url.pathname.endsWith("/upload")
          ? "initiate"
          : method === "POST" && url.pathname.endsWith("/confirm")
            ? "confirm"
            : method === "GET" && url.pathname.endsWith("/download")
              ? "download_metadata"
              : method === "GET" && !isAkb
                ? "transfer_download"
                : method === "DELETE" && url.pathname.includes("/api/v1/files/")
                  ? "delete"
                  : "other";
    observations.push({
      surface: isAkb ? "akb" : "presigned",
      hasAuthorization: request.headers.has("authorization"),
      stage,
    });
    if (options.failUpload && method === "PUT") {
      return new Response(null, { status: 503 });
    }
    return originalFetch(...args);
  };
  return {
    observations,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function expectFileCredentialBoundary(
  observations: readonly FileRequestObservation[],
): void {
  const apiCalls = observations.filter(({ surface }) => surface === "akb");
  const transferCalls = observations.filter(
    ({ surface }) => surface === "presigned",
  );
  expect(apiCalls.every(({ hasAuthorization }) => hasAuthorization)).toBe(true);
  expect(transferCalls.every(({ hasAuthorization }) => !hasAuthorization)).toBe(
    true,
  );
}

describe.skipIf(!BASE_URL)("akb live contract smoke (REEF-056)", () => {
  const baseUrl = BASE_URL as string;
  let adapter: AkbAdapter;
  let vault: string;
  let provisionCreateCount = 0;
  let provisionAlterCount = 0;

  beforeAll(async () => {
    await ensureSeedUser(baseUrl);
    const { token } = await login({
      baseUrl,
      username: USERNAME,
      password: PASSWORD,
    });
    const baseAdapter = createAkbAdapter({ baseUrl, jwt: token });
    adapter = {
      request: async (...args) => {
        const [path, init] = args;
        if (
          path === `/api/v1/tables/${encodeURIComponent(vault)}` &&
          init?.method === "POST"
        ) {
          provisionCreateCount += 1;
        }
        if (
          path.startsWith(`/api/v1/tables/${encodeURIComponent(vault)}/`) &&
          init?.method === "PATCH"
        ) {
          provisionAlterCount += 1;
        }
        return baseAdapter.request(...args);
      },
    };

    // Throwaway vault per run so local re-runs never collide; teardown below.
    const vaultSuffix =
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
        .padEnd(17, "0")
        .slice(0, 17);
    vault = `reef-live-smoke-${vaultSuffix}`;
    expect(vault).toHaveLength(33);
    await createVault({
      adapter,
      name: vault,
      description: "REEF-056 live contract smoke (throwaway)",
    });
    await ensureReefTables({ adapter, vault });

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
    // `kind` was added after the pinned compatibility ref. Accept its absence
    // there while still pinning every key returned by current akb.
    expect(
      strippedKeys(raw, Object.keys(DocumentResponseSchema.shape)),
    ).toEqual([
      "content_hash",
      "created_by_name",
      "hash_algorithm",
      ...("kind" in raw ? ["kind"] : []),
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
      ...("kind" in raw ? ["kind"] : []),
      "previous_commit",
      "previous_content_hash",
    ]);
  });

  it("search — live envelope parses and passthrough keeps akb-only fields", async () => {
    // Raw envelope: akb keys the array `results`; the mirror is `z.looseObject`
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
    ).toEqual("affected_rows" in rawMutation ? ["affected_rows"] : []);

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

  it("file lifecycle — live bytes, metadata, and credential boundaries hold", async () => {
    const filename = `live-contract-${Date.now()}.txt`;
    const mimeType = "text/plain";
    const bytes = new TextEncoder().encode(
      "Temporary file bytes for the live contract.",
    );
    const observer = installFileFetchObserver();

    let fileUri: string | undefined;
    try {
      const uploaded = await uploadAkbFile({
        adapter,
        vault,
        filename,
        mimeType,
        bytes,
      });
      fileUri = uploaded.uri;
      expect(Object.keys(uploaded).sort()).toEqual([
        "filename",
        "mimeType",
        "sizeBytes",
        "uri",
      ]);
      expect(uploaded).toMatchObject({
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
      });
      expect(uploaded.uri).toMatch(/^akb:\/\/[^/]+\/file\/[^/]+$/);
      expect(uploaded).not.toHaveProperty("upload_url");

      const downloaded = await downloadAkbFile(adapter, vault, uploaded.uri);
      expect(Object.keys(downloaded).sort()).toEqual([
        "body",
        "contentType",
        "filename",
        "sizeBytes",
      ]);
      expect(downloaded).toMatchObject({
        contentType: mimeType,
        filename,
        sizeBytes: bytes.byteLength,
      });
      expect(downloaded).not.toHaveProperty("download_url");
      expect(Array.from(new Uint8Array(downloaded.body))).toEqual(
        Array.from(bytes),
      );

      await deleteAkbFile(adapter, vault, uploaded.uri);
      fileUri = undefined;

      expect(observer.observations.map(({ stage }) => stage)).toEqual([
        "initiate",
        "transfer_upload",
        "confirm",
        "download_metadata",
        "transfer_download",
        "delete",
      ]);
      expectFileCredentialBoundary(observer.observations);
    } finally {
      observer.restore();
      if (fileUri) {
        await deleteAkbFile(adapter, vault, fileUri).catch(() => undefined);
      }
    }
  });

  it("file upload failure — initiated objects receive real delete compensation", async () => {
    let cleanupSucceeded = false;
    const cleanupAdapter: AkbAdapter = {
      request: async (...args) => {
        const [path, init] = args;
        const response = await adapter.request(...args);
        if (init?.method === "DELETE" && path.includes("/api/v1/files/")) {
          cleanupSucceeded = true;
        }
        return response;
      },
    };
    const observer = installFileFetchObserver({ failUpload: true });

    try {
      await expect(
        uploadAkbFile({
          adapter: cleanupAdapter,
          vault,
          filename: `live-failed-${Date.now()}.txt`,
          mimeType: "text/plain",
          bytes: new TextEncoder().encode("Intentional transfer failure."),
        }),
      ).rejects.toMatchObject({ name: "AkbApiError" });
    } finally {
      observer.restore();
    }

    expect(cleanupSucceeded).toBe(true);
    expect(observer.observations.map(({ stage }) => stage)).toEqual([
      "initiate",
      "transfer_upload",
      "delete",
    ]);
    expectFileCredentialBoundary(observer.observations);
  });

  it("resource relations — live link, read projection, unlink, and fixture cleanup hold", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2)}`;
    let source: TemporaryDocument | undefined;
    let target: TemporaryDocument | undefined;
    let relationLinked = false;
    try {
      source = await createTemporaryRelationDocument(
        adapter,
        vault,
        `Live relation source ${suffix}`,
      );
      target = await createTemporaryRelationDocument(
        adapter,
        vault,
        `Live relation target ${suffix}`,
      );

      const before = await getResourceRelations(adapter, {
        uri: source.uri,
        relation: "related_to",
        direction: "outgoing",
      });
      expect(before.some(({ uri }) => uri === target?.uri)).toBe(false);

      await linkResources(adapter, {
        source: source.uri,
        target: target.uri,
        relation: "related_to",
      });
      relationLinked = true;

      const linked = await getResourceRelations(adapter, {
        uri: source.uri,
        relation: "related_to",
        direction: "outgoing",
      });
      expect(linked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "related_to",
            uri: target.uri,
          }),
        ]),
      );

      await unlinkResources(adapter, {
        source: source.uri,
        target: target.uri,
        relation: "related_to",
      });
      relationLinked = false;

      const unlinked = await getResourceRelations(adapter, {
        uri: source.uri,
        relation: "related_to",
        direction: "outgoing",
      });
      expect(unlinked.some(({ uri }) => uri === target?.uri)).toBe(false);
    } finally {
      if (relationLinked && source && target) {
        await unlinkResources(adapter, {
          source: source.uri,
          target: target.uri,
          relation: "related_to",
        }).catch(() => undefined);
      }
      if (source) {
        await deleteTemporaryDocument(adapter, vault, source.path).catch(
          () => undefined,
        );
      }
      if (target) {
        await deleteTemporaryDocument(adapter, vault, target.path).catch(
          () => undefined,
        );
      }
    }
  });

  it("issue body history — live update projects only the public body event", async () => {
    const content = `Live body history contract update ${Date.now()}`;
    const updated = await updateIssue({
      adapter,
      vault,
      id: SEED_ISSUE_ID,
      partial: {},
      content,
      message: "Live body history contract update",
    });
    expect(updated.content).toBe(content);

    const history = await listIssueBodyHistory(adapter, vault, SEED_ISSUE_ID);
    const event = history.find(
      ({ hash }) =>
        hash === updated.commit_hash || updated.commit_hash.startsWith(hash),
    );
    expect(event).toBeDefined();
    if (!event) {
      throw new Error("Updated body commit was absent from history");
    }
    expect(event).toMatchObject({
      kind: "body_update",
    });
    expect(
      event.hash === updated.commit_hash ||
        updated.commit_hash.startsWith(event.hash),
    ).toBe(true);
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "actor",
      "at",
      "hash",
      "id",
      "kind",
    ]);
    if (event?.actor !== null) {
      expect(event?.actor).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      );
    }
    expect(event).not.toHaveProperty("message");
    expect(event).not.toHaveProperty("author");
    expect(event).not.toHaveProperty("author_name");
    expect(event).not.toHaveProperty("agent");
  });

  it("updateIssue — live row OCC accepts an ISO expected_updated_at", async () => {
    const current = await readIssue({ adapter, vault, id: SEED_ISSUE_ID });

    await updateIssue({
      adapter,
      vault,
      id: SEED_ISSUE_ID,
      partial: { priority: "low" },
      expectedUpdatedAt: current.issue.updated_at,
    });

    const updated = await readIssue({ adapter, vault, id: SEED_ISSUE_ID });
    expect(updated.issue.priority).toBe("low");
  });

  it("notification storage — public APIs preserve identity, recipient, state, and source contracts", async () => {
    expect(REEF_SCHEMA_VERSION).toBe(3);
    expect(provisionCreateCount).toBe(REEF_DESIRED_TABLES.length);
    expect(provisionAlterCount).toBe(0);

    const overlongVault = `reef-boundary-${"x".repeat(50)}`;
    let overlongVaultAdapterCalls = 0;
    let overlongVaultTableCount = -1;
    await createVault({
      adapter,
      name: overlongVault,
      description: "ephemeral Reef table identifier boundary probe",
    });
    try {
      const overlongVaultAdapter: AkbAdapter = {
        request: async (...args) => {
          overlongVaultAdapterCalls += 1;
          return adapter.request(...args);
        },
      };
      await expect(
        ensureReefTables({
          adapter: overlongVaultAdapter,
          vault: overlongVault,
        }),
      ).rejects.toMatchObject({ name: "SchemaValidationError" });
      expect(overlongVaultAdapterCalls).toBe(0);

      const boundaryManifest = (await adapter.request(
        `/api/v1/tables/${encodeURIComponent(overlongVault)}`,
        { resource: "ephemeral boundary vault tables" },
      )) as { items?: Array<Record<string, unknown>> };
      overlongVaultTableCount = boundaryManifest.items?.length ?? 0;
      expect(overlongVaultTableCount).toBe(0);
    } finally {
      await adapter.request(
        `/api/v1/vaults/${encodeURIComponent(overlongVault)}`,
        {
          method: "DELETE",
          resource: "ephemeral boundary vault",
        },
      );
    }

    const mismatchPreflight = [];
    const preflightBaseManifests = REEF_DESIRED_TABLES.filter(
      (manifest) =>
        manifest.name !== REEF_NOTIFICATIONS_TABLE &&
        manifest.name !== REEF_SUBSCRIPTIONS_TABLE,
    );
    for (const variant of ["column", "unique_key", "index"] as const) {
      const suffix =
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
          .padEnd(12, "0")
          .slice(0, 12);
      const mismatchVault = `reef-mm-${suffix}-${variant.slice(0, 1)}`;
      expect(mismatchVault.length).toBeLessThanOrEqual(33);
      await createVault({
        adapter,
        name: mismatchVault,
        description: "ephemeral Reef manifest mismatch preflight probe",
      });
      try {
        for (const manifest of preflightBaseManifests) {
          await adapter.request(
            `/api/v1/tables/${encodeURIComponent(mismatchVault)}`,
            {
              method: "POST",
              body: structuredClone(manifest),
              resource: `ephemeral legacy table ${manifest.name}`,
            },
          );
        }
        const notificationManifest = structuredClone(
          REEF_DESIRED_TABLES.find(
            (manifest) => manifest.name === REEF_NOTIFICATIONS_TABLE,
          ),
        );
        if (!notificationManifest) {
          throw new Error("Missing notification manifest");
        }
        if (variant === "column") {
          notificationManifest.columns = notificationManifest.columns.filter(
            (column) => column.name !== "meta",
          );
        } else if (variant === "unique_key") {
          notificationManifest.unique_keys =
            notificationManifest.unique_keys?.slice(0, 1);
        } else {
          notificationManifest.indexes = [];
        }
        await adapter.request(
          `/api/v1/tables/${encodeURIComponent(mismatchVault)}`,
          {
            method: "POST",
            body: notificationManifest,
            resource: `ephemeral mismatched ${variant} table`,
          },
        );

        let createCalls = 0;
        let alterCalls = 0;
        const mismatchAdapter: AkbAdapter = {
          request: async (...args) => {
            const [path, init] = args;
            if (
              path === `/api/v1/tables/${encodeURIComponent(mismatchVault)}` &&
              init?.method === "POST"
            ) {
              createCalls += 1;
            }
            if (
              path.startsWith(
                `/api/v1/tables/${encodeURIComponent(mismatchVault)}/`,
              ) &&
              init?.method === "PATCH"
            ) {
              alterCalls += 1;
            }
            return adapter.request(...args);
          },
        };
        await expect(
          ensureReefTables({
            adapter: mismatchAdapter,
            vault: mismatchVault,
          }),
        ).rejects.toMatchObject({ name: "SchemaValidationError" });
        expect(createCalls).toBe(0);
        expect(alterCalls).toBe(0);
        const manifest = (await adapter.request(
          `/api/v1/tables/${encodeURIComponent(mismatchVault)}`,
          { resource: "ephemeral mismatch vault tables" },
        )) as { items?: Array<Record<string, unknown>> };
        expect(manifest.items).toHaveLength(preflightBaseManifests.length + 1);
        expect(
          manifest.items?.some(
            (table) => table.name === REEF_SUBSCRIPTIONS_TABLE,
          ),
        ).toBe(false);
        mismatchPreflight.push({
          variant,
          create_calls: createCalls,
          alter_calls: alterCalls,
          manifest_count: manifest.items?.length ?? 0,
        });
      } finally {
        await adapter.request(
          `/api/v1/vaults/${encodeURIComponent(mismatchVault)}`,
          {
            method: "DELETE",
            resource: "ephemeral mismatch vault",
          },
        );
      }
    }

    await ensureReefTables({ adapter, vault });
    expect(provisionCreateCount).toBe(REEF_DESIRED_TABLES.length);
    expect(provisionAlterCount).toBe(0);

    const tableEnvelope = (await adapter.request(
      `/api/v1/tables/${encodeURIComponent(vault)}`,
      { resource: `tables in vault ${vault}` },
    )) as { items?: Array<Record<string, unknown>> };
    expect(tableEnvelope.items).toHaveLength(REEF_DESIRED_TABLES.length);
    for (const tableName of [
      REEF_NOTIFICATIONS_TABLE,
      REEF_SUBSCRIPTIONS_TABLE,
    ]) {
      const table = tableEnvelope.items?.find(
        (item) => item.name === tableName,
      );
      expect(table?.unique_keys).toEqual(expect.any(Array));
      expect(table?.indexes).toEqual(expect.any(Array));
    }

    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const occurredAt = new Date().toISOString();
    const notificationInput = {
      recipient: USERNAME,
      reefId: SEED_ISSUE_ID,
      sourceType: "issue_activity",
      sourceRef: `status:${runToken}`,
      eventType: "status_change",
      actor: "live-actor",
      occurredAt,
      payload: { replay: 1 },
    };
    const firstNotification = await akbCreateNotification(
      adapter,
      vault,
      notificationInput,
    );
    const replayedNotification = await akbCreateNotification(adapter, vault, {
      ...notificationInput,
      payload: { replay: 2 },
    });
    expect(replayedNotification.id).toBe(firstNotification.id);

    await akbCreateNotification(adapter, vault, {
      ...notificationInput,
      recipient: `${USERNAME}-other`,
    });
    const notifications = await akbListNotifications(adapter, vault, {
      recipient: USERNAME,
      state: "unread",
      limit: 10,
    });
    const notificationIdentityRows = notifications.filter(
      (notification) => notification.source_ref === notificationInput.sourceRef,
    ).length;
    expect(notificationIdentityRows).toBe(1);
    expect(
      notifications.every(
        (notification) => notification.recipient === USERNAME,
      ),
    ).toBe(true);

    const changedAt = new Date(Date.now() + 1_000).toISOString();
    const read = await akbUpdateNotificationState(adapter, vault, {
      notificationKey: firstNotification.notification_key,
      recipient: USERNAME,
      state: "read",
      changedAt,
    });
    expect(read.read_at).toBe(changedAt);
    expect(read.archived_at).toBeNull();
    const archived = await akbUpdateNotificationState(adapter, vault, {
      notificationKey: firstNotification.notification_key,
      recipient: USERNAME,
      state: "archived",
      changedAt,
    });
    expect(archived.read_at).toBe(changedAt);
    expect(archived.archived_at).toBe(changedAt);
    const unread = await akbUpdateNotificationState(adapter, vault, {
      notificationKey: firstNotification.notification_key,
      recipient: USERNAME,
      state: "unread",
    });
    expect(unread.read_at).toBeNull();
    expect(unread.archived_at).toBeNull();

    await akbUpsertSubscription(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
      source: "requester",
      status: "active",
      subscribedAt: occurredAt,
    });
    await akbMuteIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
      subscribedAt: occurredAt,
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, vault, {
        reefId: SEED_ISSUE_ID,
        subscriber: USERNAME,
      }),
    ).resolves.toBe("muted");
    await akbWatchIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
      subscribedAt: occurredAt,
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, vault, {
        reefId: SEED_ISSUE_ID,
        subscriber: USERNAME,
      }),
    ).resolves.toBe("watching");
    const subscriptionSourceRows = await akbListSubscriptions(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
    });
    expect(subscriptionSourceRows).toHaveLength(2);
    await akbRemoveSubscription(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
      source: "manual",
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, vault, {
        reefId: SEED_ISSUE_ID,
        subscriber: USERNAME,
      }),
    ).resolves.toBe("watching");
    await akbRemoveSubscription(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: USERNAME,
      source: "requester",
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, vault, {
        reefId: SEED_ISSUE_ID,
        subscriber: USERNAME,
      }),
    ).resolves.toBe("unwatched");

    if (process.env.REEF_LIVE_AKB_EVIDENCE === "1") {
      const evidence = {
        surface: "@reef/core public notification contract",
        runtime: "unique throwaway AKB vault",
        transcript: [
          {
            api: "akbEnsureReefTables",
            input: { vault: "<ephemeral>" },
            output: {
              schema_version: REEF_SCHEMA_VERSION,
              manifest_count: tableEnvelope.items?.length ?? 0,
              create_calls: provisionCreateCount,
              alter_calls: provisionAlterCount,
              second_run_create_calls: 0,
              second_run_alter_calls: 0,
            },
          },
          {
            api: "akbEnsureReefTables boundary validation",
            input: { vault_length: overlongVault.length },
            output: {
              rejected: true,
              adapter_calls: overlongVaultAdapterCalls,
              manifest_count: overlongVaultTableCount,
              partial_manifest: overlongVaultTableCount !== 0,
            },
          },
          {
            api: "akbEnsureReefTables mismatch preflight",
            input: {
              variants: ["column", "unique_key", "index"],
              existing_manifest_count: preflightBaseManifests.length + 1,
              missing_table: REEF_SUBSCRIPTIONS_TABLE,
            },
            output: mismatchPreflight,
          },
          {
            api: "akbCreateNotification + akbListNotifications",
            input: {
              recipient: "<actor>",
              source_type: "issue_activity",
              payload_replay: true,
            },
            output: {
              identity_row_count: notificationIdentityRows,
              same_identity_same_row:
                replayedNotification.id === firstNotification.id,
              recipient_isolated: notifications.every(
                (notification) => notification.recipient === USERNAME,
              ),
            },
          },
          {
            api: "akbUpdateNotificationState",
            input: { transitions: ["read", "archived", "unread"] },
            output: {
              read_timestamp_recorded: read.read_at === changedAt,
              archived_timestamp_recorded: archived.archived_at === changedAt,
              unread_timestamps_cleared:
                unread.read_at == null && unread.archived_at == null,
            },
          },
          {
            api: "subscription public APIs",
            input: {
              sources: ["requester", "manual"],
              manual_transitions: ["muted", "active", "removed"],
            },
            output: {
              independent_source_rows: subscriptionSourceRows.length,
              precedence_sequence: [
                "muted",
                "watching",
                "watching",
                "unwatched",
              ],
            },
          },
        ],
        redaction: {
          credentials: "omitted",
          vault: "ephemeral placeholder",
          usernames: "actor placeholders",
        },
      };
      const serialized = JSON.stringify(evidence);
      console.info(`SOURCE_AWARE_EVIDENCE ${serialized}`);
      console.info(
        `SOURCE_AWARE_EVIDENCE_SHA256 ${createHash("sha256").update(serialized).digest("hex")}`,
      );
    }
  });
});
