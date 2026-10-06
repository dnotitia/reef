import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  ControlPlaneError,
} from "../../src/errors";
import {
  type AkbAdapter,
  type AkbStreamAdapter,
  appendStatusChangeEvent,
  buildIssueMetadataFromCreateInput,
  canonicalJson,
  createAkbAdapter,
  createAkbAppInstallationReader,
  createAkbAppInstallationInventoryReader,
  createAkbAppRegistry,
  createAkbAppRollout,
  createAkbChangeEventTail,
  createVault,
  getAuthConfig,
  getCurrentActor,
  getMe,
  login,
  readInstallation,
  readMemberInstallationActive,
  requestInstallation,
  REEF_SCHEMA_VERSION,
  REEF_ACTIVITY_TABLE,
  REEF_SETTINGS_TABLE,
  sha256Hex,
  uninstallInstallation,
  listIssues,
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
import { verifyRequiredTables } from "../../src/adapters/akb/core/verifyRequiredTables";
import type { ControlPlaneRollout } from "../../src/schemas/controlPlane";
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
  akbCreateComment,
  akbCreateNotification,
  akbGetEffectiveSubscriptionState,
  akbListNotifications,
  akbListSubscriptions,
  akbMuteIssue,
  akbRemoveSubscription,
  akbUpdateNotificationState,
  akbUpsertSubscription,
  akbWatchIssue,
  buildSubscriptionKey,
  akbProjectNotifications,
  IssueListQuerySchema,
  notificationWakeupForChange,
} from "../../src/index";

/**
 * Live AKB contract smoke through an externally prepared endpoint.
 *
 * The static REEF-050 suite pins reef's hand-mirrored Zod envelopes against
 * CAPTURED akb responses; a capture freezes the wire shape at capture time, so
 * a redeployed akb that renames/adds a key drifts undetected. This suite
 * re-applies the SAME mirrors to LIVE responses from an externally started
 * akb endpoint, through reef's real adapter fetch path, so backend drift
 * fails here at the integration level instead of in production (REEF-049 class).
 *
 * Hermetic by design — OFF unless REEF_LIVE_AKB_URL points at a reachable AKB.
 * The writable smoke leg also requires REEF_APP_ID and REEF_RELEASE_ID so its
 * throwaway vault can be installed through AKB before Reef verifies its schema.
 * The default `pnpm --filter @reef/core test` does NOT include
 * `__tests__/integration/**` (vitest `include` is `src/**`); this file runs only
 * via the dedicated `test:live-akb` script when an external endpoint is
 * supplied. So it is never part of the always-green unit signal.
 *
 * Surfaces covered (the envelopes Reef's fetch paths actually receive):
 *   document put + get, search, sql (table_query + table_sql), files, resource
 *   relations, issue body history, human auth/config/me, and the app-principal
 *   installation reader when the selected runtime exposes that scenario.
 * Auth denial and SSO coverage is scenario-aware: local auth and invalid-session
 * cases run in every supported live leg, while account denial codes and browser
 * Keycloak callers remain explicit not-run evidence without a real IdP.
 * Provenance (`GET /provenance`) is intentionally OUT of scope: reef's fetch
 * path never calls it and reef mirrors no provenance envelope, so there is no
 * reef contract to pin. Adding one would test akb, not reef's contract.
 */

const BASE_URL = process.env.REEF_LIVE_AKB_URL;
const FIXTURE_BASE_URL = process.env.REEF_LIVE_AKB_FIXTURE_URL;
const LIVE_SCENARIO = process.env.REEF_SCENARIO;
const LIVE_APP_ID = process.env.REEF_APP_ID;
const LIVE_RELEASE_ID = process.env.REEF_RELEASE_ID;
const USERNAME = process.env.AKB_E2E_USERNAME ?? "reef-smoke";
const PASSWORD = process.env.AKB_E2E_PASSWORD ?? "reef-smoke-pw-123";
const EMAIL = process.env.REEF_LIVE_AKB_EMAIL ?? "reef-smoke@example.com";
const V3_SOURCE_VERSIONS = ["0.14.0", "0.15.0", "0.16.0"] as const;
const V3_SOURCE_MANIFEST_CHECKSUMS = {
  "0.14.0": "f7126f2d5d3755b56dc457fe75ffc212e90ac47b79428d49f5912dc787ce3e66",
  "0.15.0": "819872a2cc9901c6261b6b0d2f3b7b6076eb572c163cca8cfe91d9848013ab11",
  "0.16.0": "dad11aefa47e165b77e68664385c9d4a295f4ff20e4d64c510b1ad40b38a8133",
} satisfies Record<(typeof V3_SOURCE_VERSIONS)[number], string>;
const V3_SCHEMA_FINGERPRINT =
  "dada7b10e269e374dde943db7458dee3d5c1b69788778ea0a29169a16924a727";
const V4_LOOKUP_INDEXES = [
  { table: "reef_activity", columns: ["reef_id", "event_key"] },
  { table: "reef_attachments", columns: ["reef_id"] },
  { table: "reef_comments", columns: ["reef_id"] },
  { table: "reef_issues", columns: ["document_uri"] },
  { table: "reef_issues", columns: ["parent_id"] },
  { table: "reef_issues", columns: ["reef_id"] },
  { table: "reef_issues", columns: ["status"] },
] as const;

function fixtureOrigin(): string {
  if (!FIXTURE_BASE_URL) {
    throw new Error(
      "REEF_LIVE_AKB_FIXTURE_URL is required for app-installation-lifecycle live tests",
    );
  }
  return FIXTURE_BASE_URL.replace(/\/+$/u, "");
}

async function resetLifecycleFixture(): Promise<void> {
  const response = await fetch(`${fixtureOrigin()}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "app-installation-lifecycle" }),
  });
  expect(response.status).toBe(200);
}

async function lifecycleFixtureDiscovery(): Promise<Record<string, unknown>> {
  const response = await fetch(`${fixtureOrigin()}/discover`, {
    redirect: "manual",
  });
  expect(response.status).toBe(200);
  const discovery = record(
    await response.json(),
    "lifecycle fixture discovery",
  );
  expect(discovery.scenario).toBe("app-installation-lifecycle");
  return discovery;
}

async function lifecycleActorAdapter(
  discovery: Record<string, unknown>,
  actorName: string,
): Promise<AkbAdapter> {
  const actors = record(discovery.actors, "lifecycle fixture actors");
  const actor = record(actors[actorName], `lifecycle actor ${actorName}`);
  const username = requiredString(
    actor,
    "username",
    `lifecycle actor ${actorName}`,
  );
  const baseUrl = BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "REEF_LIVE_AKB_URL is required for app-installation-lifecycle live tests",
    );
  }
  const { token } = await login({ baseUrl, username, password: PASSWORD });
  return createAkbAdapter({ baseUrl, credential: token });
}

function lifecycleFixture(
  discovery: Record<string, unknown>,
  fixtureName: string,
): Record<string, unknown> {
  const fixtures = record(discovery.fixtures, "lifecycle fixture catalog");
  return record(fixtures[fixtureName], `lifecycle fixture ${fixtureName}`);
}

async function genericSubscriptionUpsert(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
  subscriber: string,
  source: "requester" | "assignee" | "commenter",
): Promise<void> {
  const subscriptionKey = buildSubscriptionKey({ reefId, subscriber, source });
  const subscribedAt = new Date().toISOString();
  await runSql(
    adapter,
    vault,
    `INSERT INTO reef_subscriptions (subscription_key, reef_id, subscriber, source, status, subscribed_at, meta) VALUES ($1, $2, $3, $4, 'active', $5, NULL) ON CONFLICT (subscription_key) DO UPDATE SET status = 'active' RETURNING subscription_key`,
    [subscriptionKey, reefId, subscriber, source, subscribedAt],
  );
}

function lifecycleActorControl(
  discovery: Record<string, unknown>,
  controlName: string,
): Record<string, unknown> {
  const controls = record(discovery.controls, "lifecycle fixture controls");
  return record(controls[controlName], `lifecycle control ${controlName}`);
}

async function applyLifecycleFixtureControl(
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${fixtureOrigin()}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const result = record(
    await response.json(),
    "lifecycle fixture control result",
  );
  expect(result.status).toBe("accepted");
}

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

function record(value: unknown, label: string): Record<string, unknown> {
  expect(value, label).not.toBeNull();
  expect(typeof value, label).toBe("object");
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const candidate = value[key];
  expect(typeof candidate, `${label}.${key}`).toBe("string");
  expect((candidate as string).length, `${label}.${key}`).toBeGreaterThan(0);
  return candidate as string;
}

async function reefActivityRows(
  adapter: AkbAdapter,
  vault: string,
  eventKey: string,
): Promise<Record<string, unknown>[]> {
  const result = await runSql(
    adapter,
    vault,
    `SELECT id, reef_id, event_type, event_key, payload, meta FROM ${REEF_ACTIVITY_TABLE} WHERE event_key = $1 ORDER BY reef_id ASC, id ASC`,
    [eventKey],
  );
  if (result.kind !== "table_query") {
    throw new Error("Live activity read did not return rows");
  }
  return result.items;
}

function jsonColumn(row: Record<string, unknown>, key: string): unknown {
  const value = row[key];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function reefActivityUniqueKeys(
  adapter: AkbAdapter,
  vault: string,
): Promise<string[][]> {
  const catalog = record(
    await adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
      resource: `tables in vault ${vault}`,
    }),
    "activity table catalog",
  );
  if (!Array.isArray(catalog.items)) {
    throw new Error("Activity table catalog items were not an array");
  }
  const table = catalog.items
    .map((item) => record(item, "table catalog item"))
    .find((item) => item.name === REEF_ACTIVITY_TABLE);
  if (!table) throw new Error("reef_activity was absent from the live catalog");
  if (!Array.isArray(table.unique_keys)) return [];
  return table.unique_keys.map((key) => {
    const uniqueKey = record(key, "activity unique key");
    if (!Array.isArray(uniqueKey.columns)) {
      throw new Error("Activity unique key columns were not an array");
    }
    return uniqueKey.columns.map((column) => String(column));
  });
}

async function reefTableIndexColumns(
  adapter: AkbAdapter,
  vault: string,
  tableName: string,
): Promise<string[][]> {
  const catalog = record(
    await adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
      resource: `tables in vault ${vault}`,
    }),
    "table catalog",
  );
  if (!Array.isArray(catalog.items)) {
    throw new Error("Table catalog items were not an array");
  }
  const table = catalog.items
    .map((item) => record(item, "table catalog item"))
    .find((item) => item.name === tableName);
  if (!table) throw new Error(`${tableName} was absent from the live catalog`);
  if (!Array.isArray(table.indexes)) return [];
  return table.indexes.map((value) => {
    const index = record(value, `${tableName} index`);
    if (!Array.isArray(index.columns)) {
      throw new Error(`${tableName} index columns were not an array`);
    }
    return index.columns.map((column) => {
      if (typeof column === "string") return column;
      return requiredString(
        record(column, `${tableName} index column`),
        "name",
        `${tableName} index column`,
      );
    });
  });
}

function expectSafeControlPlaneError(
  thrown: unknown,
  expected: {
    category: ControlPlaneError["category"];
    upstreamStatus: number;
    httpStatus: number;
    retryable: boolean;
    upstreamCode?: string;
  },
): void {
  expect(thrown).toBeInstanceOf(ControlPlaneError);
  expect(thrown).toMatchObject(expected);
  expect(JSON.stringify(thrown)).not.toContain(PASSWORD);
}

describe("app-installation-lifecycle fixture selection", () => {
  it.skipIf(LIVE_SCENARIO !== "app-installation-lifecycle")(
    "requires the selected external fixture and discovers its exact contract",
    async () => {
      expect(BASE_URL?.length).toBeGreaterThan(0);
      expect(FIXTURE_BASE_URL?.length).toBeGreaterThan(0);
      const discovery = await lifecycleFixtureDiscovery();
      const activeStatus = record(
        discovery.member_installation_active,
        "member installation active coordinate",
      );
      const activeFixture = lifecycleFixture(discovery, "status_active");
      const appId = requiredString(activeFixture, "app_id", "active fixture");
      const vaultId = requiredString(
        activeFixture,
        "vault_id",
        "active fixture",
      );
      expect(activeStatus).toMatchObject({
        service: "app",
        method: "GET",
        app_id: appId,
        vault_id: vaultId,
        path: `/api/v1/apps/${appId}/installations/${vaultId}/active`,
      });
      expect(record(discovery.actors, "lifecycle actors")).toHaveProperty(
        "reader",
      );
      expect(record(discovery.actors, "lifecycle actors")).toHaveProperty(
        "target_owner",
      );
      expect(record(discovery.commands, "lifecycle commands")).toHaveProperty(
        "install",
      );
      expect(record(discovery.controls, "lifecycle controls")).toHaveProperty(
        "member_installation_state",
      );
    },
  );
});

describe.skipIf(!BASE_URL || LIVE_SCENARIO !== "app-installation-lifecycle")(
  "app installation lifecycle live contract",
  () => {
    const baseUrl = BASE_URL as string;

    it("member availability is exact, scoped, and fails closed", async () => {
      await resetLifecycleFixture();
      const discovery = await lifecycleFixtureDiscovery();
      const activeFixture = lifecycleFixture(discovery, "status_active");
      const appId = requiredString(activeFixture, "app_id", "active fixture");
      const vaultId = requiredString(
        activeFixture,
        "vault_id",
        "active fixture",
      );
      const readerAdapter = await lifecycleActorAdapter(discovery, "reader");
      const systemAdminLogin = await login({
        baseUrl,
        username: USERNAME,
        password: PASSWORD,
      });
      const systemAdminAdapter = createAkbAdapter({
        baseUrl,
        credential: systemAdminLogin.token,
      });

      try {
        const memberStatus = lifecycleActorControl(
          discovery,
          "member_installation_state",
        );
        const memberStatusBody = record(
          memberStatus.body,
          "member status control body",
        );
        const states = memberStatus.states;
        expect(Array.isArray(states)).toBe(true);
        const expectedStates = [
          "installing",
          "active",
          "upgrading",
          "blocked",
          "uninstalled",
        ];
        expect(states).toEqual(expectedStates);

        for (const state of expectedStates) {
          await applyLifecycleFixtureControl({
            ...memberStatusBody,
            kind: state,
            enabled: true,
          });
          const active = await readMemberInstallationActive({
            adapter: readerAdapter,
            appId,
            vaultId,
          });
          expect(active === (state === "active")).toBe(true);
        }

        const detailedReaderError = await readInstallation({
          adapter: readerAdapter,
          appId,
          vaultId,
        }).catch((error: unknown) => error);
        expect(detailedReaderError).toBeInstanceOf(AuthError);
        expect(detailedReaderError).toMatchObject({
          context: { origin: "akb", status: 403 },
        });

        const adminMemberStatusError = await readMemberInstallationActive({
          adapter: systemAdminAdapter,
          appId,
          vaultId,
        }).catch((error: unknown) => error);
        expect(adminMemberStatusError).toBeInstanceOf(AuthError);
        expect(adminMemberStatusError).toMatchObject({
          context: { origin: "akb", status: 403 },
        });

        await applyLifecycleFixtureControl({
          ...memberStatusBody,
          kind: "active",
          enabled: true,
        });
        const faultControl = lifecycleActorControl(
          discovery,
          "fault_injection",
        );
        const faultBody = record(faultControl.body, "fault control body");
        await applyLifecycleFixtureControl({ ...faultBody, enabled: true });
        const unavailable = await readMemberInstallationActive({
          adapter: readerAdapter,
          appId,
          vaultId,
        }).catch((error: unknown) => error);
        expectSafeControlPlaneError(unavailable, {
          category: "unavailable",
          upstreamStatus: 503,
          httpStatus: 503,
          retryable: true,
          upstreamCode: "member_installation_status_unavailable",
        });

        const disableFault = record(
          faultControl.disable_body,
          "fault disable control body",
        );
        await applyLifecycleFixtureControl(disableFault);
        const memberAccess = lifecycleActorControl(discovery, "member_access");
        const memberAccessBody = record(
          memberAccess.body,
          "member access control body",
        );
        await applyLifecycleFixtureControl({
          ...memberAccessBody,
          enabled: false,
        });
        const deniedMembership = await readMemberInstallationActive({
          adapter: readerAdapter,
          appId,
          vaultId,
        }).catch((error: unknown) => error);
        expect(deniedMembership).toBeInstanceOf(AuthError);
        expect(deniedMembership).toMatchObject({
          context: { origin: "akb", status: 403 },
        });
        expect(JSON.stringify(deniedMembership)).not.toContain(PASSWORD);
      } finally {
        await resetLifecycleFixture();
      }
    }, 60_000);

    it("management commands use user sessions, replay safely, and preserve retained data", async () => {
      await resetLifecycleFixture();
      const discovery = await lifecycleFixtureDiscovery();
      const ownerAdapter = await lifecycleActorAdapter(
        discovery,
        "target_owner",
      );
      const readerAdapter = await lifecycleActorAdapter(discovery, "reader");
      const commands = record(discovery.commands, "lifecycle commands");
      const install = record(commands.install, "install command");
      const installArgs = {
        appId: requiredString(install, "app_id", "install command"),
        vaultId: requiredString(install, "vault_id", "install command"),
        releaseId: requiredString(install, "release_id", "install command"),
      };

      try {
        const readerDenied = await requestInstallation({
          adapter: readerAdapter,
          ...installArgs,
          mode: "install",
        }).catch((error: unknown) => error);
        expect(readerDenied).toBeInstanceOf(AuthError);
        expect(readerDenied).toMatchObject({
          context: { origin: "akb", status: 403 },
        });

        const firstInstall = await requestInstallation({
          adapter: ownerAdapter,
          ...installArgs,
          mode: "install",
        });
        const replayedInstall = await requestInstallation({
          adapter: ownerAdapter,
          ...installArgs,
          mode: "install",
        });
        expect(firstInstall.commandStatus).toBe("accepted");
        expect(replayedInstall.commandStatus).toBe("already_applied");
        expect(replayedInstall.replayed).toBe(true);

        const conflict = record(
          commands.conflict_release,
          "conflicting install command",
        );
        const conflictError = await requestInstallation({
          adapter: ownerAdapter,
          appId: requiredString(conflict, "app_id", "conflicting command"),
          vaultId: requiredString(conflict, "vault_id", "conflicting command"),
          releaseId: requiredString(
            conflict,
            "release_id",
            "conflicting command",
          ),
          mode: "install",
        }).catch((error: unknown) => error);
        expect(conflictError).toBeInstanceOf(ConflictError);

        const activeFixture = lifecycleFixture(discovery, "status_active");
        const activeAppId = requiredString(
          activeFixture,
          "app_id",
          "active fixture",
        );
        const activeVaultId = requiredString(
          activeFixture,
          "vault_id",
          "active fixture",
        );
        const observedCalls: Array<{
          path: string;
          method: string;
          body: unknown;
        }> = [];
        const observingAdapter: AkbAdapter = {
          request: async (path, init) => {
            observedCalls.push({
              path,
              method: init?.method ?? "GET",
              body: init?.body,
            });
            return ownerAdapter.request(path, init);
          },
        };
        const uninstalled = await uninstallInstallation({
          adapter: observingAdapter,
          appId: activeAppId,
          vaultId: activeVaultId,
        });
        const uninstallCall = observedCalls.at(-1);
        expect(
          uninstalled.commandStatus === "accepted" &&
            uninstallCall?.method === "DELETE" &&
            uninstallCall.body === undefined,
        ).toBe(true);
        const uninstallReplay = await uninstallInstallation({
          adapter: ownerAdapter,
          appId: activeAppId,
          vaultId: activeVaultId,
        });
        expect(uninstallReplay.commandStatus).toBe("already_applied");
        expect(uninstallReplay.replayed).toBe(true);
        await expect(
          readMemberInstallationActive({
            adapter: ownerAdapter,
            appId: activeAppId,
            vaultId: activeVaultId,
          }),
        ).resolves.toBe(false);

        const restore = record(
          commands.restore_compatible,
          "compatible restore command",
        );
        const restored = await requestInstallation({
          adapter: ownerAdapter,
          appId: requiredString(restore, "app_id", "restore command"),
          vaultId: requiredString(restore, "vault_id", "restore command"),
          releaseId: requiredString(restore, "release_id", "restore command"),
          mode: "restore",
        });
        expect(restored.commandStatus).toBe("accepted");

        const freshRetained = lifecycleFixture(discovery, "fresh_retained");
        const retainedConflict = await requestInstallation({
          adapter: ownerAdapter,
          appId: requiredString(freshRetained, "app_id", "retained fixture"),
          vaultId: requiredString(
            freshRetained,
            "vault_id",
            "retained fixture",
          ),
          releaseId: requiredString(
            freshRetained,
            "requested_release_id",
            "retained fixture",
          ),
          mode: "fresh",
        }).catch((error: unknown) => error);
        expect(retainedConflict).toBeInstanceOf(ConflictError);

        const freshEmpty = record(commands.fresh_empty, "fresh empty command");
        const freshInstallation = await requestInstallation({
          adapter: ownerAdapter,
          appId: requiredString(freshEmpty, "app_id", "fresh command"),
          vaultId: requiredString(freshEmpty, "vault_id", "fresh command"),
          releaseId: requiredString(freshEmpty, "release_id", "fresh command"),
          mode: "fresh",
        });
        expect(freshInstallation.commandStatus).toBe("accepted");
        expect(freshInstallation.replayed).toBe(false);
      } finally {
        await resetLifecycleFixture();
      }
    }, 60_000);
  },
);

/**
 * Ensure a login-able seed user exists. akb grants admin to the FIRST registered
 * user, so a fresh external endpoint needs this once; on a re-run the duplicate register
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
  surface: "akb" | "transfer" | "other";
  hasAuthorization: boolean;
  stage: string;
}

function installFileFetchObserver(options: { failUpload?: boolean } = {}): {
  observations: FileRequestObservation[];
  restore: () => void;
} {
  const observations: FileRequestObservation[] = [];
  const originalFetch = globalThis.fetch;
  let downloadTransferUrl: string | undefined;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = new Request(input, init);
    const method = request.method;
    const url = new URL(request.url);
    const isDownloadTransfer =
      method === "GET" && downloadTransferUrl === request.url;
    const isTransfer = method === "PUT" || isDownloadTransfer;
    const isAkb = !isTransfer && url.pathname.startsWith("/api/v1/");
    const stage =
      method === "PUT"
        ? "transfer_upload"
        : method === "POST" && url.pathname.endsWith("/upload")
          ? "initiate"
          : method === "POST" && url.pathname.endsWith("/confirm")
            ? "confirm"
            : isDownloadTransfer
              ? "transfer_download"
              : method === "GET" && url.pathname.endsWith("/download")
                ? "download_metadata"
                : method === "DELETE" && url.pathname.includes("/api/v1/files/")
                  ? "delete"
                  : "other";
    observations.push({
      surface: isAkb ? "akb" : isTransfer ? "transfer" : "other",
      hasAuthorization: request.headers.has("authorization"),
      stage,
    });
    if (options.failUpload && method === "PUT") {
      return new Response(null, { status: 503 });
    }
    const response = await originalFetch(...args);
    if (stage === "download_metadata" && response.ok) {
      const metadata: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      if (
        typeof metadata === "object" &&
        metadata !== null &&
        "download_url" in metadata &&
        typeof metadata.download_url === "string"
      ) {
        downloadTransferUrl = new URL(metadata.download_url, request.url).href;
      }
    }
    return response;
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
    ({ surface }) => surface === "transfer",
  );
  const transferStages = observations.filter(({ stage }) =>
    stage.startsWith("transfer_"),
  );
  expect(apiCalls.every(({ hasAuthorization }) => hasAuthorization)).toBe(true);
  expect(transferStages.every(({ surface }) => surface === "transfer")).toBe(
    true,
  );
  expect(transferCalls.every(({ hasAuthorization }) => !hasAuthorization)).toBe(
    true,
  );
}

function wrapLiveAdapter(
  baseAdapter: AkbStreamAdapter,
  request: AkbStreamAdapter["request"],
): AkbStreamAdapter {
  return { request, stream: baseAdapter.stream };
}

async function waitForActiveInstallation(params: {
  adapter: AkbAdapter;
  appId: string;
  vaultId: string;
}): Promise<void> {
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const installation = await readInstallation(params);
    if (installation.lifecycle === "active") return;
    if (
      installation.lifecycle === "blocked" ||
      installation.lifecycle === "uninstalled"
    ) {
      throw new Error(
        `Live workspace installation stopped in ${installation.lifecycle}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    "Timed out waiting for the live workspace installation to become active",
  );
}

async function waitForAppliedRollout(params: {
  rollout: ReturnType<typeof createAkbAppRollout>;
  appId: string;
  jobId: string;
}): Promise<ControlPlaneRollout> {
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const rollout = await params.rollout.getRollout(params.appId, params.jobId);
    if (rollout.status === "applied") return rollout;
    if (rollout.status === "blocked") {
      throw new Error("Live workspace schema rollout was blocked");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the live workspace schema rollout");
}

async function waitForTerminalRollout(params: {
  rollout: ReturnType<typeof createAkbAppRollout>;
  appId: string;
  jobId: string;
}): Promise<ControlPlaneRollout> {
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const rollout = await params.rollout.getRollout(params.appId, params.jobId);
    if (rollout.status === "applied" || rollout.status === "blocked") {
      return rollout;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the live schema rollout to finish");
}

/** Register the exact historical v3 artifact for a source-version proof. */
async function registerV3BaselineRelease(params: {
  baseUrl: string;
  token: string;
  appId: string;
  version: (typeof V3_SOURCE_VERSIONS)[number];
}): Promise<{ releaseId: string; checksum: string }> {
  const { version } = params;
  const manifest = record(
    JSON.parse(
      await readFile(
        new URL(
          "../fixtures/reef-release-baselines/v3-manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
    `fixture v3 manifest ${version}`,
  );
  if (manifest.schema_version !== 3) {
    throw new Error(`Fixture v3 release ${version} did not contain schema v3`);
  }
  const schema = record(manifest.schema, `fixture v3 schema ${version}`);
  if (schema.fingerprint !== V3_SCHEMA_FINGERPRINT) {
    throw new Error(`Fixture v3 release ${version} fingerprint was unexpected`);
  }
  if (!Array.isArray(manifest.transition_plans)) {
    throw new Error(`Fixture v3 release ${version} had no transition plans`);
  }
  const transitionPlans = manifest.transition_plans.map((value) => {
    const plan = record(value, `fixture v3 transition plan ${version}`);
    if (!Array.isArray(plan.steps)) {
      throw new Error(`Fixture v3 release ${version} had malformed steps`);
    }
    return {
      source: plan.source,
      steps: plan.steps.map((value) => {
        const { checksum: _checksum, ...step } = record(
          value,
          `fixture v3 transition step ${version}`,
        );
        return step;
      }),
    };
  });
  const checksum = await sha256Hex(
    canonicalJson({
      manifest_version: manifest.manifest_version,
      app_key: manifest.app_key,
      source_revision: manifest.source_revision,
      image_digest: manifest.image_digest,
      schema_version: manifest.schema_version,
      schema,
      transition_plans: transitionPlans,
      product_version: version,
    }),
  );
  if (V3_SOURCE_MANIFEST_CHECKSUMS[version] !== checksum) {
    throw new Error(`Fixture v3 release ${version} checksum was invalid`);
  }
  const response = await fetch(
    `${params.baseUrl.replace(/\/+$/u, "")}/api/v1/apps/${encodeURIComponent(params.appId)}/releases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version,
        manifest,
        manifest_checksum: checksum,
      }),
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `Fixture v3 release registration failed (${response.status})`,
    );
  }
  const release = record(await response.json(), "fixture v3 release");
  return {
    releaseId: requiredString(release, "id", "fixture v3 release"),
    checksum,
  };
}

describe("AKB live adapter construction", () => {
  it("preserves the stream capability when request instrumentation wraps the adapter", () => {
    const baseAdapter = createAkbAdapter({
      baseUrl: "https://akb.test",
      credential: "test-jwt",
    });
    const wrapped = wrapLiveAdapter(baseAdapter, baseAdapter.request);

    expect(typeof wrapped.stream).toBe("function");
  });
});

const describeLiveContract = describe.skipIf(
  !BASE_URL || !LIVE_APP_ID || !LIVE_RELEASE_ID,
);
describeLiveContract("akb live contract smoke (REEF-056)", () => {
  const baseUrl = BASE_URL as string;
  let adapter: AkbStreamAdapter;
  let sessionToken: string;
  let vault: string;
  let vaultId: string;
  let legacyVault: string | undefined;
  let legacyVaultId: string | undefined;
  let followingVault: string | undefined;
  let followingVaultId: string | undefined;
  const sourceProofVaults: Array<{ name: string; vaultId: string }> = [];
  const verifiedSourceVersions: string[] = [];
  let tableCatalogGetCount = 0;
  let schemaMutationCount = 0;
  let observeReadiness = false;
  let readinessRequests: Array<{ path: string; method: string }> = [];
  let registry: ReturnType<typeof createAkbAppRegistry>;
  let rolloutApi: ReturnType<typeof createAkbAppRollout>;
  let migrationEvidence: Record<string, unknown> = { status: "not_run" };
  let rolloutEvidence: Record<string, unknown> = { status: "not_run" };
  let readinessEvidence: Record<string, unknown> | undefined;
  let authEvidence: Record<string, unknown> | undefined;
  let installationEvidence: Record<string, unknown> = {
    status: "not_run",
    reason:
      LIVE_SCENARIO === "app-control-plane"
        ? "The app-control-plane discovery exposes active installations only; it has no blocked app-principal installation coordinate."
        : "The pinned AKB runtime does not expose the app-control-plane scenario or app-principal installation GET.",
    follow_up:
      LIVE_SCENARIO === "app-control-plane"
        ? "Add or select a repository-owned scenario that discovers a blocked app-principal installation, then run this same reader proof against it."
        : "Run the moving-main app-control-plane leg with its discovered app credential and fixture installation coordinates.",
  };

  beforeAll(async () => {
    await ensureSeedUser(baseUrl);
    const { token } = await login({
      baseUrl,
      username: USERNAME,
      password: PASSWORD,
    });
    sessionToken = token;
    const baseAdapter = createAkbAdapter({ baseUrl, credential: token });
    adapter = wrapLiveAdapter(baseAdapter, async (...args) => {
      const [path, init] = args;
      const tableRoot = `/api/v1/tables/${encodeURIComponent(vault)}`;
      const method = init?.method ?? "GET";
      if (observeReadiness) readinessRequests.push({ path, method });
      const isSchemaRoute =
        path === tableRoot ||
        (path.startsWith(`${tableRoot}/`) && path !== `${tableRoot}/sql`);
      if (isSchemaRoute && method !== "GET") schemaMutationCount += 1;
      if (path === tableRoot && method === "GET") tableCatalogGetCount += 1;
      return baseAdapter.request(...args);
    });

    // Read the prepared current release before registering fixture-only sources.
    registry = createAkbAppRegistry({ baseUrl, adminToken: token });
    rolloutApi = createAkbAppRollout({ baseUrl, adminToken: token });
    const registeredApp = await registry.getApp(LIVE_APP_ID as string);
    const registeredRelease = await registry.getRelease(
      LIVE_APP_ID as string,
      LIVE_RELEASE_ID as string,
    );
    expect(registeredApp.appKey).toBe("reef");
    expect(registeredRelease.appId).toBe(registeredApp.id);
    expect(registeredRelease.id).toBe(LIVE_RELEASE_ID);
    expect(registeredRelease.manifest.app_key).toBe("reef");
    expect(registeredRelease.manifest.schema_version).toBe(REEF_SCHEMA_VERSION);

    const declaredSourcePlans = registeredRelease.manifest.transition_plans
      .filter(({ source }) => typeof source !== "string")
      .map(({ source }) => source);
    expect(declaredSourcePlans).toEqual(
      V3_SOURCE_VERSIONS.map((release_version) => ({
        release_version,
        schema_fingerprint: V3_SCHEMA_FINGERPRINT,
      })),
    );

    const baselineReleases = new Map<
      (typeof V3_SOURCE_VERSIONS)[number],
      Awaited<ReturnType<typeof registerV3BaselineRelease>>
    >();
    for (const version of V3_SOURCE_VERSIONS) {
      baselineReleases.set(
        version,
        await registerV3BaselineRelease({
          baseUrl,
          token,
          appId: registeredApp.id,
          version,
        }),
      );
    }
    const legacySuffix =
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
        .padEnd(17, "0")
        .slice(0, 17);

    const createBaselineVault = async (
      version: (typeof V3_SOURCE_VERSIONS)[number],
      name: string,
      description: string,
    ) => {
      const baseline = baselineReleases.get(version);
      if (!baseline) {
        throw new Error(`Fixture v3 release ${version} was not registered`);
      }
      const created = await createVault({ adapter, name, description });
      sourceProofVaults.push({ name, vaultId: created.vault_id });
      await requestInstallation({
        adapter,
        appId: registeredApp.id,
        vaultId: created.vault_id,
        releaseId: baseline.releaseId,
        mode: "install",
      });
      return { name, vaultId: created.vault_id, version, baseline };
    };

    const applyBaselineRelease = async (
      targets: Awaited<ReturnType<typeof createBaselineVault>>[],
    ) => {
      const first = targets[0];
      if (!first || targets.some(({ version }) => version !== first.version)) {
        throw new Error("Fixture baseline rollout must use one source version");
      }
      const baselineRequest = await rolloutApi.requestRollout({
        appId: registeredApp.id,
        releaseId: first.baseline.releaseId,
        manifestChecksum: first.baseline.checksum,
        idempotencyKey: randomUUID(),
      });
      const applied = await waitForAppliedRollout({
        rollout: rolloutApi,
        appId: registeredApp.id,
        jobId: baselineRequest.rollout.jobId,
      });
      expect(applied.status).toBe("applied");
      for (const target of targets) {
        const rolloutTarget = applied.targets.find(
          ({ vaultId }) => vaultId === target.vaultId,
        );
        expect(rolloutTarget).toBeDefined();
        expect(
          await reefActivityUniqueKeys(adapter, target.name),
        ).not.toContainEqual(["reef_id", "event_key"]);
        for (const index of V4_LOOKUP_INDEXES) {
          expect(
            await reefTableIndexColumns(adapter, target.name, index.table),
          ).not.toContainEqual([...index.columns]);
        }
        const installation = await readInstallation({
          adapter,
          appId: registeredApp.id,
          vaultId: target.vaultId,
        });
        expect(installation.currentRelease?.id).toBe(target.baseline.releaseId);
        expect(installation.currentRelease?.version).toBe(target.version);
        expect(installation.observed?.schemaFingerprint).toBe(
          V3_SCHEMA_FINGERPRINT,
        );
      }
      return applied;
    };

    const applyCurrentRelease = async (
      targets: Awaited<ReturnType<typeof createBaselineVault>>[],
    ) => {
      const request = await rolloutApi.requestRollout({
        appId: registeredApp.id,
        releaseId: registeredRelease.id,
        manifestChecksum: registeredRelease.manifestChecksum,
        idempotencyKey: randomUUID(),
      });
      const applied = await waitForAppliedRollout({
        rollout: rolloutApi,
        appId: registeredApp.id,
        jobId: request.rollout.jobId,
      });
      expect(applied.status).toBe("applied");
      for (const target of targets) {
        expect(
          applied.targets.some(({ vaultId }) => vaultId === target.vaultId),
        ).toBe(true);
        const rolloutTarget = applied.targets.find(
          ({ vaultId }) => vaultId === target.vaultId,
        );
        const transitionSteps = rolloutTarget?.steps ?? [];
        expect(rolloutTarget?.steps).toContainEqual(
          expect.objectContaining({
            operation: "add_unique_key",
            state: "applied",
          }),
        );
        const indexSteps = transitionSteps.filter(
          (step) => step.operation === "add_index",
        );
        expect(indexSteps).toHaveLength(V4_LOOKUP_INDEXES.length);
        expect(indexSteps.map(({ state }) => state)).toEqual(
          Array.from({ length: V4_LOOKUP_INDEXES.length }, () => "applied"),
        );
        expect(
          await reefActivityUniqueKeys(adapter, target.name),
        ).toContainEqual(["reef_id", "event_key"]);
        for (const index of V4_LOOKUP_INDEXES) {
          expect(
            await reefTableIndexColumns(adapter, target.name, index.table),
          ).toContainEqual([...index.columns]);
        }
        await expect(
          verifyRequiredTables({
            adapter,
            vault: target.name,
            canManage: true,
          }),
        ).resolves.toBeUndefined();
        const installation = await readInstallation({
          adapter,
          appId: registeredApp.id,
          vaultId: target.vaultId,
        });
        expect(installation.currentRelease?.version).toBe(
          registeredRelease.version,
        );
      }
      verifiedSourceVersions.push(...targets.map(({ version }) => version));
      return applied;
    };

    const v3_15 = await createBaselineVault(
      "0.15.0",
      `reef-v3-15-${legacySuffix}`,
      "REEF-366 v0.15.0 source transition proof (throwaway)",
    );
    await applyBaselineRelease([v3_15]);
    await applyCurrentRelease([v3_15]);
    expect(
      (
        await uninstallInstallation({
          adapter,
          appId: registeredApp.id,
          vaultId: v3_15.vaultId,
        })
      ).installation.lifecycle,
    ).toBe("uninstalled");

    const v3_16 = await createBaselineVault(
      "0.16.0",
      `reef-v3-16-${legacySuffix}`,
      "REEF-366 v0.16.0 source transition proof (throwaway)",
    );
    await applyBaselineRelease([v3_16]);
    await applyCurrentRelease([v3_16]);
    expect(
      (
        await uninstallInstallation({
          adapter,
          appId: registeredApp.id,
          vaultId: v3_16.vaultId,
        })
      ).installation.lifecycle,
    ).toBe("uninstalled");

    legacyVault = `reef-v3-live-${legacySuffix}`;
    followingVault = `reef-v3-next-${legacySuffix}`;
    const v3_14 = await createBaselineVault(
      "0.14.0",
      legacyVault,
      "REEF-366 v0.14.0 migration blocker proof (throwaway)",
    );
    const v3_14Following = await createBaselineVault(
      "0.14.0",
      followingVault,
      "REEF-366 later rollout target proof (throwaway)",
    );
    legacyVaultId = v3_14.vaultId;
    followingVaultId = v3_14Following.vaultId;
    const baselineApplied = await applyBaselineRelease([v3_14, v3_14Following]);
    expect(baselineApplied.targets).toHaveLength(2);
    expect(legacyVault).toBe(v3_14.name);
    expect(followingVault).toBe(v3_14Following.name);
    expect(legacyVaultId).toBe(v3_14.vaultId);
    expect(followingVaultId).toBe(v3_14Following.vaultId);
    const baselineLegacyKeys = await reefActivityUniqueKeys(
      adapter,
      legacyVault,
    );
    expect(baselineLegacyKeys).not.toContainEqual(["reef_id", "event_key"]);

    const duplicateEventKey = `status_change:todo->in_progress@${new Date().toISOString()}`;
    const insertLegacyDuplicate = async (
      payload: Record<string, unknown>,
      meta: Record<string, unknown>,
    ): Promise<void> => {
      const inserted = await runSql(
        adapter,
        legacyVault as string,
        `INSERT INTO ${REEF_ACTIVITY_TABLE} (reef_id, event_type, event_key, payload, meta) VALUES ($1, $2, $3, $4::json, $5::json)`,
        [
          "REEF-777",
          "status_change",
          duplicateEventKey,
          JSON.stringify(payload),
          JSON.stringify(meta),
        ],
      );
      if (inserted.kind !== "table_sql") {
        throw new Error("v3 duplicate fixture row was not inserted");
      }
    };
    await insertLegacyDuplicate(
      { from: "todo", to: "in_progress" },
      {
        actor: "alice",
        at: "2026-08-01T00:00:00.000Z",
        source: "first-write",
      },
    );
    await insertLegacyDuplicate(
      { from: "todo", to: "done" },
      {
        actor: "bob",
        at: "2026-08-01T00:00:01.000Z",
        source: "conflicting-write",
      },
    );
    const duplicateRowsBefore = await reefActivityRows(
      adapter,
      legacyVault,
      duplicateEventKey,
    );
    expect(duplicateRowsBefore).toHaveLength(2);
    const preservedDuplicate = duplicateRowsBefore[0];
    const removedDuplicate = duplicateRowsBefore[1];
    if (!preservedDuplicate || !removedDuplicate) {
      throw new Error("v3 duplicate fixture rows were not readable");
    }
    const preservedDuplicateId = requiredString(
      preservedDuplicate,
      "id",
      "preserved v3 duplicate fixture row",
    );
    const removedDuplicateId = requiredString(
      removedDuplicate,
      "id",
      "removed v3 duplicate fixture row",
    );
    const candidateRequestKey = randomUUID();
    const candidateRequest = await rolloutApi.requestRollout({
      appId: registeredApp.id,
      releaseId: registeredRelease.id,
      manifestChecksum: registeredRelease.manifestChecksum,
      idempotencyKey: candidateRequestKey,
    });
    const blocked = await waitForTerminalRollout({
      rollout: rolloutApi,
      appId: registeredApp.id,
      jobId: candidateRequest.rollout.jobId,
    });
    expect(blocked.status).toBe("blocked");
    const failedTarget = blocked.targets.find(
      (target) => target.vaultId === legacyVaultId,
    );
    expect(failedTarget).toBeDefined();
    const failedStep = failedTarget?.steps.find(
      (step) => step.operation === "add_unique_key",
    );
    expect(failedStep).toBeDefined();
    expect(failedStep?.state).not.toBe("applied");
    expect(
      failedTarget?.steps.some(
        (step) => step.operation === "add_index" && step.state === "applied",
      ),
    ).toBe(false);
    expect(
      blocked.targets
        .find((target) => target.vaultId === followingVaultId)
        ?.steps.some((step) => step.state === "applied"),
    ).toBe(false);
    expect(
      await reefActivityUniqueKeys(adapter, legacyVault),
    ).not.toContainEqual(["reef_id", "event_key"]);
    expect(
      await reefActivityUniqueKeys(adapter, followingVault),
    ).not.toContainEqual(["reef_id", "event_key"]);
    for (const index of V4_LOOKUP_INDEXES) {
      expect(
        await reefTableIndexColumns(adapter, legacyVault, index.table),
      ).not.toContainEqual([...index.columns]);
      expect(
        await reefTableIndexColumns(adapter, followingVault, index.table),
      ).not.toContainEqual([...index.columns]);
    }
    expect(
      await reefActivityRows(adapter, legacyVault, duplicateEventKey),
    ).toEqual(duplicateRowsBefore);
    await expect(
      verifyRequiredTables({
        adapter,
        vault: legacyVault,
        canManage: true,
      }),
    ).rejects.toThrow();
    const repeatedRequest = await rolloutApi.requestRollout({
      appId: registeredApp.id,
      releaseId: registeredRelease.id,
      manifestChecksum: registeredRelease.manifestChecksum,
      idempotencyKey: candidateRequestKey,
    });
    expect(repeatedRequest.rollout.jobId).toBe(blocked.jobId);
    expect(repeatedRequest.rollout.status).toBe("blocked");
    expect(repeatedRequest.rollout.replayed).toBe(true);

    // The operator explicitly resolves the blocker in this throwaway vault.
    await runSql(
      adapter,
      legacyVault,
      `DELETE FROM ${REEF_ACTIVITY_TABLE} WHERE id = $1`,
      [removedDuplicateId],
    );
    const resumeRequestKey = randomUUID();
    const resumeRequest = await rolloutApi.resumeRollout({
      appId: registeredApp.id,
      releaseId: registeredRelease.id,
      manifestChecksum: registeredRelease.manifestChecksum,
      sourceRolloutId: blocked.jobId,
      idempotencyKey: resumeRequestKey,
    });
    const resumed = await waitForAppliedRollout({
      rollout: rolloutApi,
      appId: registeredApp.id,
      jobId: resumeRequest.rollout.jobId,
    });
    expect(resumed.status).toBe("applied");
    for (const vaultId of [legacyVaultId, followingVaultId]) {
      const resumedTarget = resumed.targets.find(
        (target) => target.vaultId === vaultId,
      );
      expect(resumedTarget).toBeDefined();
      expect(resumedTarget?.steps).toContainEqual(
        expect.objectContaining({
          operation: "add_unique_key",
          state: "applied",
        }),
      );
      const appliedIndexSteps =
        resumedTarget?.steps.filter((step) => step.operation === "add_index") ??
        [];
      expect(appliedIndexSteps).toHaveLength(V4_LOOKUP_INDEXES.length);
      expect(appliedIndexSteps.map(({ state }) => state)).toEqual(
        Array.from({ length: V4_LOOKUP_INDEXES.length }, () => "applied"),
      );
    }
    const repeatedResume = await rolloutApi.resumeRollout({
      appId: registeredApp.id,
      releaseId: registeredRelease.id,
      manifestChecksum: registeredRelease.manifestChecksum,
      sourceRolloutId: blocked.jobId,
      idempotencyKey: resumeRequestKey,
    });
    expect(repeatedResume.rollout.jobId).toBe(resumeRequest.rollout.jobId);
    expect(repeatedResume.rollout.status).toBe("applied");
    expect(repeatedResume.rollout.replayed).toBe(true);
    expect(await reefActivityUniqueKeys(adapter, legacyVault)).toContainEqual([
      "reef_id",
      "event_key",
    ]);
    expect(
      await reefActivityUniqueKeys(adapter, followingVault),
    ).toContainEqual(["reef_id", "event_key"]);
    for (const index of V4_LOOKUP_INDEXES) {
      expect(
        await reefTableIndexColumns(adapter, legacyVault, index.table),
      ).toContainEqual([...index.columns]);
      expect(
        await reefTableIndexColumns(adapter, followingVault, index.table),
      ).toContainEqual([...index.columns]);
    }
    await expect(
      verifyRequiredTables({
        adapter,
        vault: legacyVault,
        canManage: true,
      }),
    ).resolves.toBeUndefined();
    const retained = await reefActivityRows(
      adapter,
      legacyVault,
      duplicateEventKey,
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]?.id).toBe(preservedDuplicateId);
    expect(jsonColumn(retained[0] ?? {}, "payload")).toEqual(
      jsonColumn(preservedDuplicate, "payload"),
    );
    expect(jsonColumn(retained[0] ?? {}, "meta")).toEqual(
      jsonColumn(preservedDuplicate, "meta"),
    );
    await expect(
      verifyRequiredTables({
        adapter,
        vault: followingVault,
        canManage: true,
      }),
    ).resolves.toBeUndefined();
    verifiedSourceVersions.push("0.14.0");
    expect([...verifiedSourceVersions].sort()).toEqual([...V3_SOURCE_VERSIONS]);
    migrationEvidence = {
      verified_source_versions: [...verifiedSourceVersions].sort(),
      source_schema_fingerprint: V3_SCHEMA_FINGERPRINT,
      blocked_without_cleanup: true,
      duplicate_rows_preserved_on_failure: true,
      following_target_untouched_on_failure: true,
      lookup_indexes_not_applied_on_failure: true,
      repeated_request_remained_blocked: true,
      explicit_resume_status: resumed.status,
      repeated_resume_status: repeatedResume.rollout.status,
      repeated_resume_replayed: repeatedResume.rollout.replayed,
      migration_step_applied_for_all_sources: true,
      retained_event_count: retained.length,
      activity_key_present_after_resume: true,
      lookup_indexes_applied_after_resume: true,
    };
    verifiedSourceVersions.sort();
    rolloutEvidence = {
      api: "createAkbAppRollout",
      verified_source_versions: [...verifiedSourceVersions],
      source_schema_fingerprint: V3_SCHEMA_FINGERPRINT,
      blocked_status: blocked.status,
      blocked_targets: blocked.targets.map((target) => ({
        state: target.state,
        steps: target.steps.map(({ operation, state }) => ({
          operation,
          state,
        })),
      })),
      resume_status: resumed.status,
      resume_replay: {
        status: repeatedResume.rollout.status,
        replayed: repeatedResume.rollout.replayed,
        same_job: repeatedResume.rollout.jobId === resumeRequest.rollout.jobId,
      },
      resumed_targets: resumed.targets.map((target) => ({
        state: target.state,
        steps: target.steps.map(({ operation, state }) => ({
          operation,
          state,
        })),
      })),
    };

    // A fresh v4 installation is requested after the existing-v3 rollout proof.
    const freshSuffix =
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
        .padEnd(17, "0")
        .slice(0, 17);
    vault = `reef-live-smoke-${freshSuffix}`;
    expect(vault).toHaveLength(33);
    const freshVault = await createVault({
      adapter,
      name: vault,
      description: "REEF-056 live contract smoke (throwaway)",
    });
    vaultId = freshVault.vault_id;
    await requestInstallation({
      adapter,
      appId: registeredApp.id,
      vaultId,
      releaseId: registeredRelease.id,
      mode: "install",
    });
    const freshRequest = await rolloutApi.requestRollout({
      appId: registeredApp.id,
      releaseId: registeredRelease.id,
      manifestChecksum: registeredRelease.manifestChecksum,
      idempotencyKey: randomUUID(),
    });
    const freshApplied = await waitForAppliedRollout({
      rollout: rolloutApi,
      appId: registeredApp.id,
      jobId: freshRequest.rollout.jobId,
    });
    expect(
      freshApplied.targets.some((target) => target.vaultId === vaultId),
    ).toBe(true);
    rolloutEvidence.fresh_install_status = freshApplied.status;
    await waitForActiveInstallation({
      adapter,
      appId: registeredApp.id,
      vaultId,
    });

    // Seed one issue through reef's REAL write path (doc PUT + reef_issues row).
    const issue = buildIssueMetadataFromCreateInput({
      id: SEED_ISSUE_ID,
      create: {
        fields: { title: "Live contract smoke seed" },
        content: "Seed body for the REEF-056 live contract smoke.",
      },
      author: USERNAME,
    });
    await writeIssue({
      adapter,
      vault,
      issue,
      content: "Seed body for the REEF-056 live contract smoke.",
    });
  }, 120_000);

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
    if (adapter) {
      for (const { name } of sourceProofVaults) {
        await adapter
          .request(`/api/v1/vaults/${encodeURIComponent(name)}`, {
            method: "DELETE",
            resource: `vault ${name}`,
          })
          .catch(() => {});
      }
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

  it("issue date ranges and timestamp cursors — live timestamp parameters require an SQL cast", async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const secondIssue = buildIssueMetadataFromCreateInput({
      id: "REEF-002",
      create: {
        fields: { title: "Live contract range boundary" },
        content: "Second issue for the live date-range contract.",
      },
      author: USERNAME,
    });
    await writeIssue({
      adapter,
      vault,
      issue: secondIssue,
      content: "Second issue for the live date-range contract.",
    });

    const timestampRows = await runSql(
      adapter,
      vault,
      "SELECT reef_id, created_at, updated_at FROM reef_issues WHERE reef_id IN ('REEF-001', 'REEF-002') LIMIT 2",
    );
    expect(timestampRows.kind).toBe("table_query");
    if (timestampRows.kind !== "table_query") return;
    expect(timestampRows.items).toHaveLength(2);

    const sqlPath = `/api/v1/tables/${encodeURIComponent(vault)}/sql`;
    for (const field of ["created_at", "updated_at"] as const) {
      const ordered = [...timestampRows.items].toSorted((left, right) => {
        const leftValue = requiredString(left, field, `date range ${field}`);
        const rightValue = requiredString(right, field, `date range ${field}`);
        return (
          Date.parse(leftValue) - Date.parse(rightValue) ||
          leftValue.localeCompare(rightValue)
        );
      });
      const first = ordered[0];
      const last = ordered[1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (!first || !last) return;
      const from = requiredString(first, field, `date range ${field}`);
      const to = requiredString(last, field, `date range ${field}`);
      expect(from).not.toBe(to);

      const rawError = await adapter
        .request(sqlPath, {
          method: "POST",
          body: {
            sql: `SELECT reef_id FROM reef_issues WHERE "${field}" >= $1 AND "${field}" < $2`,
            params: [from, to],
          },
          resource: `raw ${field} date range`,
        })
        .catch((error: unknown) => error);
      expect(rawError).toBeInstanceOf(AkbApiError);
      expect(rawError).toMatchObject({ status: 400 });

      const query = (limit?: number) =>
        IssueListQuerySchema.parse({
          archived: true,
          date_range: { field, from, to },
          sort_field: "reef_id",
          sort_order: "asc",
          ...(limit === undefined ? {} : { limit }),
        });
      const bounded = await listIssues({
        adapter,
        vault,
        query: query(10),
      });
      const unbounded = await listIssues({
        adapter,
        vault,
        query: query(),
      });
      expect(bounded.issues.map(({ id }) => id)).toEqual([first.reef_id]);
      expect(unbounded.issues.map(({ id }) => id)).toEqual([first.reef_id]);

      const emptyFrom = new Date(Date.parse(to) + 1).toISOString();
      const emptyTo = new Date(Date.parse(to) + 2).toISOString();
      const empty = await listIssues({
        adapter,
        vault,
        query: IssueListQuerySchema.parse({
          archived: true,
          date_range: { field, from: emptyFrom, to: emptyTo },
          sort_field: "reef_id",
          sort_order: "asc",
          limit: 10,
        }),
      });
      expect(empty.issues).toEqual([]);
    }

    for (const { field, order } of [
      { field: "created_at" as const, order: "asc" as const },
      { field: "created_at" as const, order: "desc" as const },
      { field: "updated_at" as const, order: "asc" as const },
      { field: "updated_at" as const, order: "desc" as const },
    ]) {
      const ordered = [...timestampRows.items].toSorted((left, right) => {
        const leftValue = requiredString(left, field, `cursor ${field}`);
        const rightValue = requiredString(right, field, `cursor ${field}`);
        const direction = order === "asc" ? 1 : -1;
        return (
          (Date.parse(leftValue) - Date.parse(rightValue)) * direction ||
          leftValue.localeCompare(rightValue) * direction
        );
      });
      const first = ordered[0];
      const second = ordered[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;

      const firstValue = requiredString(first, field, `cursor ${field}`);
      const secondValue = requiredString(second, field, `cursor ${field}`);
      const from = new Date(
        Math.min(Date.parse(firstValue), Date.parse(secondValue)) - 1,
      ).toISOString();
      const to = new Date(
        Math.max(Date.parse(firstValue), Date.parse(secondValue)) + 1,
      ).toISOString();
      const query = (cursor?: string) =>
        IssueListQuerySchema.parse({
          archived: true,
          status: ["backlog"],
          date_range: { field, from, to },
          sort_field: field,
          sort_order: order,
          limit: 1,
          ...(cursor === undefined ? {} : { cursor }),
        });

      const firstPage = await listIssues({
        adapter,
        vault,
        query: query(),
      });
      expect(firstPage.issues.map(({ id }) => id)).toEqual([first.reef_id]);
      expect(firstPage.next_cursor).toEqual(expect.any(String));

      const rawError = await adapter
        .request(sqlPath, {
          method: "POST",
          body: {
            sql: `SELECT reef_id FROM reef_issues WHERE "${field}" ${order === "asc" ? ">" : "<"} $1`,
            params: [firstValue],
          },
          resource: `raw ${field} cursor`,
        })
        .catch((error: unknown) => error);
      expect(rawError).toBeInstanceOf(AkbApiError);
      expect(rawError).toMatchObject({ status: 400 });

      const secondPage = await listIssues({
        adapter,
        vault,
        query: query(firstPage.next_cursor ?? undefined),
      });
      expect(secondPage.issues.map(({ id }) => id)).toEqual([second.reef_id]);
      expect(secondPage.next_cursor).toBeNull();
      expect(secondValue).not.toBe(firstValue);
    }
  });

  it("auth — live config, local login, me, actor, and safe denial contracts hold", async () => {
    const configResponse = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/auth/config`,
      { redirect: "manual" },
    );
    expect(configResponse.status).toBe(200);
    const rawConfig = record(await configResponse.json(), "auth config");
    const localAuth = record(rawConfig.local_auth, "auth config local_auth");
    const keycloak = record(rawConfig.keycloak, "auth config keycloak");
    const schemaVersion = rawConfig.schema_version;
    expect(schemaVersion).toBe(2);
    expect(localAuth.enabled).toBe(true);
    expect(keycloak).toMatchObject({
      enabled: false,
      browser_session_ready: false,
    });
    expect(JSON.stringify(rawConfig)).not.toContain(PASSWORD);

    const parsedConfig = await getAuthConfig({ baseUrl });
    expect(parsedConfig.config).toMatchObject({
      schema_version: 2,
      auth_mode: "local",
      local_auth: { enabled: true },
      keycloak: { enabled: false, browser_session_ready: false },
      providers: [],
    });

    const { profile } = await getMe({ adapter });
    expect(typeof profile.username).toBe("string");
    expect((profile.username ?? "").length).toBeGreaterThan(0);
    expect(profile.username === USERNAME).toBe(true);
    const actor = await getCurrentActor({ adapter, jwt: sessionToken });
    expect(actor.actor === USERNAME).toBe(true);

    const invalidCredential = await login({
      baseUrl,
      username: USERNAME,
      password: `${PASSWORD}-invalid`,
    }).catch((caught) => caught);
    expect(invalidCredential).toBeInstanceOf(AuthError);
    expect(invalidCredential).toMatchObject({
      context: { origin: "akb", status: 401 },
    });
    expect(JSON.stringify(invalidCredential)).not.toContain(PASSWORD);

    const invalidSessionAdapter = createAkbAdapter({
      baseUrl,
      credential: "invalid-session-token",
    });
    const invalidSession = await getMe({
      adapter: invalidSessionAdapter,
    }).catch((caught) => caught);
    expect(invalidSession).toBeInstanceOf(AuthError);
    expect(invalidSession).toMatchObject({
      context: { origin: "akb", status: 401 },
    });

    const notRunSso = {
      status: "not_run",
      reason:
        "The externally prepared endpoint uses local auth and does not provide a real Keycloak browser session.",
      required_environment:
        "keycloak-overlay specialist runtime with real Keycloak",
      follow_up:
        "Run the existing Keycloak login, code exchange, and logout callers against that specialist environment.",
      owner: "tracked internally",
    };
    authEvidence = {
      scenario: LIVE_SCENARIO ?? "not_declared",
      config: {
        status: "observed",
        schema_version: schemaVersion,
        local_auth_enabled: true,
        keycloak_enabled: false,
        core_boundary: "parsed",
      },
      success: {
        login: "observed",
        me: "observed",
        current_actor: "observed",
        credential_values: "omitted",
      },
      denials: {
        invalid_credentials: { status: "denied", http_status: 401 },
        invalid_session: { status: "denied", http_status: 401 },
        membership_required: notRunSso,
        account_suspended: notRunSso,
        identity_conflict: notRunSso,
      },
      sso: {
        startKeycloakLogin: notRunSso,
        exchangeKeycloakCode: notRunSso,
        startKeycloakLogout: notRunSso,
      },
    };
  });

  it.skipIf(!FIXTURE_BASE_URL || LIVE_SCENARIO !== "app-control-plane")(
    "app principal — discovered credential exchange and installation GET preserve the public projection",
    async () => {
      const discoveryResponse = await fetch(
        `${FIXTURE_BASE_URL?.replace(/\/+$/, "")}/discover`,
        { redirect: "manual" },
      );
      expect(discoveryResponse.status).toBe(200);
      const discovery = record(
        await discoveryResponse.json(),
        "fixture discovery",
      );
      expect(discovery.scenario).toBe("app-control-plane");
      const runtime = record(discovery.runtime, "fixture discovery runtime");
      expect(requiredString(runtime, "source_revision", "runtime")).toMatch(
        /^[0-9a-f]{7,64}$/iu,
      );
      const coordinates = record(
        discovery.coordinates,
        "fixture discovery coordinates",
      );
      const installationStatus = record(
        coordinates.installation_status,
        "installation status coordinate",
      );
      expect(installationStatus).toMatchObject({
        service: "app",
        method: "GET",
      });
      const adminCoordinates = record(
        coordinates.admin,
        "admin control-plane coordinates",
      );
      expect(
        record(adminCoordinates.credential, "credential coordinate"),
      ).toMatchObject({
        service: "app",
        method: "POST",
      });
      expect(
        record(adminCoordinates.exchange, "exchange coordinate"),
      ).toMatchObject({
        service: "app",
        method: "POST",
        path: "/api/v1/auth/app-token",
      });

      const apps = record(discovery.apps, "fixture discovery apps");
      const targetApp = record(apps.target, "target app");
      const targetAppId = requiredString(targetApp, "id", "target app");
      expect(Array.isArray(discovery.installations)).toBe(true);
      const installations = discovery.installations as unknown[];
      expect(installations.length).toBeGreaterThan(0);
      const activeFixture = record(installations[0], "active installation");
      const active = {
        vaultId: requiredString(
          activeFixture,
          "vault_id",
          "active installation",
        ),
        installationId: requiredString(
          activeFixture,
          "id",
          "active installation",
        ),
      };
      const scopeCases = record(
        discovery.scope_cases,
        "fixture discovery scope cases",
      );
      const otherApp = record(scopeCases.other_app, "other-app scope case");
      const foreignAppId = requiredString(
        otherApp,
        "app_id",
        "other-app scope case",
      );
      const foreignVaultId = requiredString(
        otherApp,
        "vault_id",
        "other-app scope case",
      );
      expect(foreignAppId === targetAppId).toBe(false);
      const deployment = `live-contract-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      let credentialId: string | undefined;

      try {
        const issued = record(
          await adapter.request(`/api/v1/apps/${targetAppId}/credentials`, {
            method: "POST",
            body: { deployment },
            resource: "ephemeral app credential",
          }),
          "issued app credential",
        );
        const issuedCredential = requiredString(
          issued,
          "credential",
          "issued app credential",
        );
        credentialId = requiredString(
          issued,
          "credential_id",
          "issued app credential",
        );
        expect(issuedCredential.startsWith("akb_app_")).toBe(true);
        expect(issued.app_id === targetAppId).toBe(true);
        expect(issued.deployment).toBe(deployment);

        const exchangeResponse = await fetch(
          `${baseUrl.replace(/\/+$/, "")}/api/v1/auth/app-token`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ credential: issuedCredential }),
            redirect: "manual",
          },
        );
        expect(exchangeResponse.status).toBe(200);
        const exchange = record(
          await exchangeResponse.json(),
          "app token exchange",
        );
        const appToken = requiredString(
          exchange,
          "access_token",
          "app token exchange",
        );
        expect(exchange.token_type).toBe("Bearer");
        expect(exchange.expires_in).toEqual(expect.any(Number));

        const reader = createAkbAppInstallationReader({
          baseUrl,
          appToken,
        });
        const activeResult = await reader.getInstallation(active.vaultId);
        // Keep the identity checks scalar so assertion failures cannot print
        // randomized fixture IDs or the raw upstream projection.
        expect(
          activeResult.installationId === active.installationId &&
            activeResult.appId === targetAppId &&
            activeResult.vaultId === active.vaultId &&
            activeResult.lifecycle === "active",
        ).toBe(true);

        // The current app-control-plane discovery has no blocked app-principal
        // coordinate. Keep that domain-state proof explicitly not-run instead
        // of inventing a fixture key or treating setup state as an observation.
        expect(activeResult).not.toHaveProperty("ownedResources");
        expect(activeResult).not.toHaveProperty("checkpoint");
        expect(activeResult).not.toHaveProperty("recentError");
        expect(activeResult).not.toHaveProperty("commandStatus");
        expect(activeResult).not.toHaveProperty("replayed");

        const inventoryReader = createAkbAppInstallationInventoryReader({
          baseUrl,
          appCredential: issuedCredential,
        });
        const inventory = await inventoryReader.listActiveInstallations();
        const activeInventory = inventory.find(
          (item) => item.installationId === active.installationId,
        );
        expect(activeInventory).toEqual({
          installationId: active.installationId,
          appId: targetAppId,
          vaultId: active.vaultId,
          vaultName: expect.any(String),
          lifecycle: "active",
        });
        expect(inventory.every((item) => item.appId === targetAppId)).toBe(
          true,
        );
        expect(
          inventory.every(
            (item) =>
              Object.keys(item).sort().join(",") ===
              "appId,installationId,lifecycle,vaultId,vaultName",
          ),
        ).toBe(true);

        const foreignError = await reader
          .getInstallation(foreignVaultId)
          .catch((caught) => caught);
        expectSafeControlPlaneError(foreignError, {
          category: "authorization",
          upstreamStatus: 403,
          httpStatus: 403,
          retryable: false,
        });

        const invalidTokenReader = createAkbAppInstallationReader({
          baseUrl,
          appToken: "invalid-app-token",
        });
        const invalidTokenError = await invalidTokenReader
          .getInstallation(active.vaultId)
          .catch((caught) => caught);
        expectSafeControlPlaneError(invalidTokenError, {
          category: "authentication",
          upstreamStatus: 401,
          httpStatus: 401,
          retryable: false,
        });

        installationEvidence = {
          status: "observed",
          scenario: "app-control-plane",
          credential_exchange: {
            admin_issue: "observed",
            app_token_exchange: "observed",
            credential_values: "omitted",
          },
          success: {
            active_installation: "observed",
            projection: "bounded",
          },
          blocked: {
            status: "not_run",
            reason:
              "The app-control-plane discovery exposes active installations only; it has no blocked app-principal installation coordinate.",
            follow_up:
              "Use an externally prepared scenario that discovers a blocked app-principal installation, then run this same reader assertion.",
            owner: "tracked internally",
            terminal_success_claimed: false,
          },
          denials: {
            other_app_scope: {
              status: "denied",
              category: "authorization",
              http_status: 403,
            },
            invalid_app_token: {
              status: "denied",
              category: "authentication",
              http_status: 401,
            },
          },
          cleanup: "ephemeral credential revoked",
        };
      } finally {
        if (credentialId) {
          await adapter
            .request(
              `/api/v1/apps/${targetAppId}/credentials/${credentialId}`,
              {
                method: "DELETE",
                resource: "ephemeral app credential",
              },
            )
            .catch(() => undefined);
        }
      }
    },
  );

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
      "actorFallback",
      "actorUsername",
      "at",
      "hash",
      "id",
      "kind",
    ]);
    if (event?.actorUsername !== null) {
      expect(event?.actorUsername).not.toMatch(
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

  it("required-table verification reads the active release schema without schema writes", async () => {
    const readState = async () => {
      const [tableCatalog, app, release, schemaVersionResult] =
        await Promise.all([
          adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
            resource: `tables in vault ${vault}`,
          }),
          registry.getApp(LIVE_APP_ID as string),
          registry.getRelease(LIVE_APP_ID as string, LIVE_RELEASE_ID as string),
          runSql(
            adapter,
            vault,
            `SELECT value FROM ${REEF_SETTINGS_TABLE} WHERE key = $1 LIMIT 1`,
            ["schema_version"],
          ),
        ]);
      if (schemaVersionResult.kind !== "table_query") {
        throw new Error("Schema-version evidence query did not return rows");
      }
      return {
        tableCatalog,
        registry: {
          appId: app.id,
          appKey: app.appKey,
          releaseId: release.id,
          releaseAppId: release.appId,
          manifestChecksum: release.manifestChecksum,
          manifestSchemaVersion: release.manifest.schema_version,
          manifestSchema: release.manifest.schema,
        },
        schemaVersion: schemaVersionResult.items[0]?.value ?? null,
      };
    };

    const readsBefore = tableCatalogGetCount;
    const mutationsBefore = schemaMutationCount;
    const before = await readState();
    readinessRequests = [];
    observeReadiness = true;
    try {
      await verifyRequiredTables({ adapter, vault, canManage: true });
    } finally {
      observeReadiness = false;
    }
    const after = await readState();

    expect(tableCatalogGetCount).toBe(readsBefore + 3);
    expect(readinessRequests).toEqual([
      {
        path: `/api/v1/tables/${encodeURIComponent(vault)}`,
        method: "GET",
      },
    ]);
    expect(schemaMutationCount).toBe(mutationsBefore);
    expect(after.tableCatalog).toEqual(before.tableCatalog);
    expect(after.registry).toEqual(before.registry);
    expect(after.schemaVersion).toEqual(before.schemaVersion);

    const catalogItems = record(
      before.tableCatalog,
      "live table catalog",
    ).items;
    if (!Array.isArray(catalogItems)) {
      throw new Error("Live table catalog items were not an array");
    }
    readinessEvidence = {
      preparation: rolloutEvidence,
      catalog_sha256: createHash("sha256")
        .update(JSON.stringify(before.tableCatalog) ?? "null")
        .digest("hex"),
      catalog_item_count: catalogItems.length,
      registry_sha256: createHash("sha256")
        .update(JSON.stringify(before.registry) ?? "null")
        .digest("hex"),
      registry_unchanged: true,
      schema_version: before.schemaVersion,
      schema_version_unchanged: true,
      catalog_unchanged: true,
      requests_during_verification: readinessRequests.map(
        ({ path, method }) => ({
          route:
            path === `/api/v1/tables/${encodeURIComponent(vault)}`
              ? "table-catalog"
              : path === `/api/v1/tables/${encodeURIComponent(vault)}/sql`
                ? "table-sql"
                : "other",
          method,
        }),
      ),
      reef_origin_schema_mutations: schemaMutationCount - mutationsBefore,
      separate_control_plane_audit_api:
        "not exposed by Reef's public AKB adapter; the applied rollout record is captured",
    };
    if (process.env.REEF_LIVE_AKB_EVIDENCE === "1") {
      console.info(
        `REEF_WORKSPACE_READINESS_EVIDENCE ${JSON.stringify(readinessEvidence)}`,
      );
    }
  });

  it("uses the activity unique key for concurrent and sequential replay", async () => {
    expect(migrationEvidence).toMatchObject({
      verified_source_versions: [...V3_SOURCE_VERSIONS],
      source_schema_fingerprint: V3_SCHEMA_FINGERPRINT,
      blocked_without_cleanup: true,
      duplicate_rows_preserved_on_failure: true,
      following_target_untouched_on_failure: true,
      lookup_indexes_not_applied_on_failure: true,
      repeated_request_remained_blocked: true,
      explicit_resume_status: "applied",
      repeated_resume_status: "applied",
      repeated_resume_replayed: true,
      migration_step_applied_for_all_sources: true,
      retained_event_count: 1,
      activity_key_present_after_resume: true,
      lookup_indexes_applied_after_resume: true,
    });
    if (!legacyVault) {
      throw new Error("Live v3 migration target was not initialized");
    }

    const eventAt = new Date().toISOString();
    const replayKey = `status_change:todo->in_progress@${eventAt}`;
    const writeStatusEvent = async (reefId: string, actor: string) =>
      appendStatusChangeEvent(adapter, legacyVault as string, {
        reefId,
        from: "todo",
        to: "in_progress",
        at: eventAt,
        actor,
        source: "reef-366-live-proof",
      });

    await Promise.all([
      writeStatusEvent("REEF-901", "alice"),
      writeStatusEvent("REEF-901", "bob"),
    ]);
    const afterRace = await reefActivityRows(adapter, legacyVault, replayKey);
    expect(afterRace).toHaveLength(1);
    const originalPersisted = {
      payload: jsonColumn(afterRace[0] ?? {}, "payload"),
      meta: jsonColumn(afterRace[0] ?? {}, "meta"),
    };

    await writeStatusEvent("REEF-901", "replay-user");
    const afterSequentialReplay = await reefActivityRows(
      adapter,
      legacyVault,
      replayKey,
    );
    expect(afterSequentialReplay).toHaveLength(1);
    expect({
      payload: jsonColumn(afterSequentialReplay[0] ?? {}, "payload"),
      meta: jsonColumn(afterSequentialReplay[0] ?? {}, "meta"),
    }).toEqual(originalPersisted);

    await writeStatusEvent("REEF-902", "carol");
    const acrossIssues = await reefActivityRows(
      adapter,
      legacyVault,
      replayKey,
    );
    expect(acrossIssues.map((row) => row.reef_id)).toEqual([
      "REEF-901",
      "REEF-902",
    ]);
  }, 120_000);

  it("notification storage — public APIs preserve identity, recipient, state, and source contracts", async () => {
    expect(schemaMutationCount).toBe(0);

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
        runtime: "externally prepared throwaway AKB endpoint",
        auth: authEvidence ?? { status: "not_run" },
        app_installation: installationEvidence,
        transcript: [
          {
            api: "verifyRequiredTables",
            input: { vault: "<ephemeral>" },
            output: readinessEvidence ?? { status: "not_run" },
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

  it("change event tail — live activity/comment wakes projector and preserves notification identity", async () => {
    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const recipient = `${USERNAME}-event-${runToken}`;
    const fanoutRecipientA = `${USERNAME}-fanout-a-${runToken}`;
    const fanoutRecipientB = `${USERNAME}-fanout-b-${runToken}`;

    await akbWatchIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: recipient,
    });
    await akbWatchIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: fanoutRecipientA,
    });
    await akbWatchIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: fanoutRecipientB,
    });

    const activation = await akbProjectNotifications({ adapter, vault });
    expect(activation.activated).toBe(true);

    const baseStream = adapter.stream;
    let resolveConnected: () => void = () => undefined;
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve;
    });
    const observingAdapter: AkbStreamAdapter = {
      request: adapter.request,
      stream: async (path, init) => {
        const response = await baseStream(path, init);
        resolveConnected();
        return response;
      },
    };
    const tail = createAkbChangeEventTail(observingAdapter);
    const streamController = new AbortController();
    const observedSources = new Set<string>();
    const projectionResults: Array<{
      source: string;
      failed: boolean;
    }> = [];
    let activityCursor: string | undefined;
    let commentCursor: string | undefined;

    const consume = (async () => {
      try {
        for await (const record of tail.subscribe({
          vault,
          signal: streamController.signal,
        })) {
          if (record.type !== "change") continue;
          const source = notificationWakeupForChange(record.event, vault);
          if (!source || observedSources.has(source)) continue;
          if (source === "comment") commentCursor = record.cursor;

          const result = await akbProjectNotifications({ adapter, vault });
          projectionResults.push({
            source,
            failed: result.activity.failed || result.comment.failed,
          });
          expect(result.activity.failed).toBe(false);
          expect(result.comment.failed).toBe(false);
          observedSources.add(source);
          if (source === "activity") activityCursor = record.cursor;
          if (
            observedSources.has("activity") &&
            observedSources.has("comment")
          ) {
            streamController.abort();
            return;
          }
        }
      } catch (error) {
        if (!streamController.signal.aborted) throw error;
      }
    })();

    await connected;
    const firstTransitionAt = new Date().toISOString();
    await updateIssue({
      adapter,
      vault,
      id: SEED_ISSUE_ID,
      partial: {
        status: "in_progress",
        last_status_change: firstTransitionAt,
      },
    });
    const comment = await akbCreateComment(
      adapter,
      vault,
      SEED_ISSUE_ID,
      `Live Change Event comment ${runToken}`,
      USERNAME,
    );
    await consume;

    expect([...observedSources].sort()).toEqual(["activity", "comment"]);
    expect(projectionResults.every(({ failed }) => !failed)).toBe(true);
    expect(activityCursor).toEqual(expect.any(String));
    expect(commentCursor).toEqual(expect.any(String));

    const firstNotifications = await akbListNotifications(adapter, vault, {
      recipient,
      limit: 100,
    });
    const firstActivityNotifications = firstNotifications.filter(
      (notification) => notification.source_type === "activity",
    );
    const firstCommentNotifications = firstNotifications.filter(
      (notification) =>
        notification.source_type === "comment" &&
        notification.source_ref === comment.id,
    );
    expect(firstActivityNotifications).toHaveLength(1);
    expect(firstCommentNotifications).toHaveLength(1);
    const activityNotification = firstActivityNotifications[0];
    if (!activityNotification || !activityCursor) {
      throw new Error("Live activity notification was not projected");
    }

    const archivedAt = new Date(Date.now() + 1_000).toISOString();
    await akbUpdateNotificationState(adapter, vault, {
      notificationKey: activityNotification.notification_key,
      recipient,
      state: "archived",
      changedAt: archivedAt,
    });

    // Reconnect after the activity event. The next retained event is the
    // already-processed comment event, so this exercises duplicate delivery
    // without resetting either Source Cursor or notification state.
    const reconnectController = new AbortController();
    let replayedComment = false;
    try {
      for await (const record of tail.subscribe({
        vault,
        lastEventId: activityCursor,
        signal: reconnectController.signal,
      })) {
        if (record.type !== "change") continue;
        if (notificationWakeupForChange(record.event, vault) !== "comment") {
          continue;
        }
        replayedComment = true;
        const result = await akbProjectNotifications({ adapter, vault });
        expect(result.activity.failed).toBe(false);
        expect(result.comment.failed).toBe(false);
        reconnectController.abort();
        break;
      }
    } catch (error) {
      if (!reconnectController.signal.aborted) throw error;
    }
    expect(replayedComment).toBe(true);

    const afterReconnect = await akbListNotifications(adapter, vault, {
      recipient,
      limit: 100,
    });
    const archivedActivity = afterReconnect.filter(
      (notification) =>
        notification.source_type === "activity" &&
        notification.source_ref === activityNotification.source_ref,
    );
    expect(archivedActivity).toHaveLength(1);
    expect(archivedActivity[0]?.state).toBe("archived");

    // Exercise the same source ordering documented for generic AKB MCP writes:
    // update the issue projection, synchronize only automatic source rows,
    // insert a comment, add its commenter source, then append activity.
    const genericRequester = `${USERNAME}-generic-requester-${runToken}`;
    const genericAssignee = `${USERNAME}-generic-assignee-${runToken}`;
    const genericCommenter = `${USERNAME}-generic-commenter-${runToken}`;
    const priorIssueResult = await runSql(
      adapter,
      vault,
      "SELECT requester, assigned_to FROM reef_issues WHERE reef_id = $1",
      [SEED_ISSUE_ID],
    );
    if (priorIssueResult.kind !== "table_query" || !priorIssueResult.items[0]) {
      throw new Error("Live generic-write issue was not found");
    }
    const priorIssue = record(
      priorIssueResult.items[0],
      "issue source snapshot",
    );
    const previousRequester =
      typeof priorIssue.requester === "string" ? priorIssue.requester : null;
    const previousAssignee =
      typeof priorIssue.assigned_to === "string"
        ? priorIssue.assigned_to
        : null;
    await runSql(
      adapter,
      vault,
      "UPDATE reef_issues SET requester = $1, assigned_to = $2 WHERE reef_id = $3 RETURNING reef_id",
      [genericRequester, genericAssignee, SEED_ISSUE_ID],
    );
    if (previousRequester && previousRequester !== genericRequester) {
      await runSql(
        adapter,
        vault,
        "DELETE FROM reef_subscriptions WHERE reef_id = $1 AND subscriber = $2 AND source = 'requester' RETURNING id",
        [SEED_ISSUE_ID, previousRequester],
      );
    }
    if (previousAssignee && previousAssignee !== genericAssignee) {
      await runSql(
        adapter,
        vault,
        "DELETE FROM reef_subscriptions WHERE reef_id = $1 AND subscriber = $2 AND source = 'assignee' RETURNING id",
        [SEED_ISSUE_ID, previousAssignee],
      );
    }
    await genericSubscriptionUpsert(
      adapter,
      vault,
      SEED_ISSUE_ID,
      genericRequester,
      "requester",
    );
    await genericSubscriptionUpsert(
      adapter,
      vault,
      SEED_ISSUE_ID,
      genericAssignee,
      "assignee",
    );
    await akbMuteIssue(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: genericCommenter,
    });

    const genericController = new AbortController();
    let resolveGenericConnected: () => void = () => undefined;
    const genericConnected = new Promise<void>((resolve) => {
      resolveGenericConnected = resolve;
    });
    const genericSources = new Set<string>();
    const genericProjectionResults: Array<{
      source: string;
      failed: boolean;
    }> = [];
    let genericCommentCursor: string | undefined;
    let genericActivityCursor: string | undefined;
    const genericConsume = (async () => {
      try {
        for await (const record of tail.subscribe({
          vault,
          lastEventId: commentCursor,
          signal: genericController.signal,
          onOpen: resolveGenericConnected,
        })) {
          if (record.type !== "change") continue;
          const source = notificationWakeupForChange(record.event, vault);
          if (!source) continue;
          const result = await akbProjectNotifications({ adapter, vault });
          genericProjectionResults.push({
            source,
            failed: result.activity.failed || result.comment.failed,
          });
          expect(result.activity.failed).toBe(false);
          expect(result.comment.failed).toBe(false);
          genericSources.add(source);
          if (source === "comment") genericCommentCursor = record.cursor;
          if (source === "activity") {
            genericActivityCursor = record.cursor;
            genericController.abort();
            return;
          }
        }
      } catch (error) {
        if (!genericController.signal.aborted) throw error;
      }
    })();
    await genericConnected;

    const genericCommentAt = new Date().toISOString();
    const genericCommentBody = `Generic AKB comment ${runToken}`;
    const genericCommentInsert = await runSql(
      adapter,
      vault,
      `WITH target_issue AS (SELECT reef_id FROM reef_issues WHERE reef_id = $1) INSERT INTO reef_comments (reef_id, body, meta) SELECT reef_id, $2, $3::json FROM target_issue RETURNING id`,
      [
        SEED_ISSUE_ID,
        genericCommentBody,
        JSON.stringify({
          author: genericCommenter,
          created_at: genericCommentAt,
          edited_at: null,
          parent_comment_id: null,
          thread_root_id: null,
        }),
      ],
    );
    expect(
      genericCommentInsert.kind === "table_query" &&
        genericCommentInsert.items.length,
    ).toBe(1);
    await genericSubscriptionUpsert(
      adapter,
      vault,
      SEED_ISSUE_ID,
      genericCommenter,
      "commenter",
    );

    const genericActivityAt = new Date().toISOString();
    const genericActivityKey = `assignee_change:${previousAssignee ?? "∅"}->${genericAssignee}@${genericActivityAt}`;
    await runSql(
      adapter,
      vault,
      "INSERT INTO reef_activity (reef_id, event_type, event_key, payload, meta) VALUES ($1, 'assignee_change', $2, $3::json, $4::json) RETURNING id",
      [
        SEED_ISSUE_ID,
        genericActivityKey,
        JSON.stringify({
          from: previousAssignee,
          to: genericAssignee,
        }),
        JSON.stringify({
          actor: USERNAME,
          at: genericActivityAt,
          source: "ai-agent:user_request",
        }),
      ],
    );
    await genericConsume;

    expect([...genericSources].sort()).toEqual(["activity", "comment"]);
    expect(genericProjectionResults.every(({ failed }) => !failed)).toBe(true);
    expect(genericCommentCursor).toEqual(expect.any(String));
    expect(genericActivityCursor).toEqual(expect.any(String));

    const requesterSources = await akbListSubscriptions(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: genericRequester,
    });
    const assigneeSources = await akbListSubscriptions(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: genericAssignee,
    });
    const commenterSources = await akbListSubscriptions(adapter, vault, {
      reefId: SEED_ISSUE_ID,
      subscriber: genericCommenter,
    });
    expect(
      requesterSources.some(
        ({ source, status }) => source === "requester" && status === "active",
      ),
    ).toBe(true);
    expect(
      assigneeSources.some(
        ({ source, status }) => source === "assignee" && status === "active",
      ),
    ).toBe(true);
    expect(
      commenterSources.some(
        ({ source, status }) => source === "commenter" && status === "active",
      ),
    ).toBe(true);
    expect(
      commenterSources.some(
        ({ source, status }) => source === "manual" && status === "muted",
      ),
    ).toBe(true);

    const requesterNotifications = await akbListNotifications(adapter, vault, {
      recipient: genericRequester,
      limit: 100,
    });
    const assigneeNotifications = await akbListNotifications(adapter, vault, {
      recipient: genericAssignee,
      limit: 100,
    });
    const commenterNotifications = await akbListNotifications(adapter, vault, {
      recipient: genericCommenter,
      limit: 100,
    });
    const requesterEvent = requesterNotifications.filter(
      (notification) =>
        notification.source_type === "activity" &&
        notification.source_ref === genericActivityKey,
    );
    const assigneeEvent = assigneeNotifications.filter(
      (notification) =>
        notification.source_type === "activity" &&
        notification.source_ref === genericActivityKey,
    );
    expect(requesterEvent).toHaveLength(1);
    expect(assigneeEvent).toHaveLength(1);
    expect(
      commenterNotifications.some(
        (notification) =>
          notification.source_type === "activity" &&
          notification.source_ref === genericActivityKey,
      ),
    ).toBe(false);

    const genericRequesterNotification = requesterEvent[0];
    if (
      !genericRequesterNotification ||
      !genericCommentCursor ||
      !genericActivityCursor
    ) {
      throw new Error("Generic AKB activity notification was not projected");
    }
    await akbUpdateNotificationState(adapter, vault, {
      notificationKey: genericRequesterNotification.notification_key,
      recipient: genericRequester,
      state: "archived",
      changedAt: new Date(Date.now() + 1_000).toISOString(),
    });

    const genericReplayController = new AbortController();
    let replayedGenericActivity = false;
    try {
      for await (const record of tail.subscribe({
        vault,
        lastEventId: genericCommentCursor,
        signal: genericReplayController.signal,
      })) {
        if (
          record.type !== "change" ||
          record.cursor !== genericActivityCursor
        ) {
          continue;
        }
        const result = await akbProjectNotifications({ adapter, vault });
        expect(result.activity.failed).toBe(false);
        expect(result.comment.failed).toBe(false);
        replayedGenericActivity = true;
        genericReplayController.abort();
        break;
      }
    } catch (error) {
      if (!genericReplayController.signal.aborted) throw error;
    }
    expect(replayedGenericActivity).toBe(true);
    const requesterAfterReplay = await akbListNotifications(adapter, vault, {
      recipient: genericRequester,
      limit: 100,
    });
    const preservedGenericNotification = requesterAfterReplay.filter(
      (notification) =>
        notification.notification_key ===
        genericRequesterNotification.notification_key,
    );
    expect(preservedGenericNotification).toHaveLength(1);
    expect(preservedGenericNotification[0]?.state).toBe("archived");

    // Force a partial fan-out failure after a new activity event. The first
    // recipient may be written, but the source checkpoint must remain behind;
    // the retry then converges to the same identities.
    const secondTransitionAt = new Date(Date.now() + 2_000).toISOString();
    await updateIssue({
      adapter,
      vault,
      id: SEED_ISSUE_ID,
      partial: {
        status: "in_review",
        last_status_change: secondTransitionAt,
      },
    });
    const sqlPath = `/api/v1/tables/${encodeURIComponent(vault)}/sql`;
    const failingAdapter: AkbAdapter = {
      request: async (path, init) => {
        if (path === sqlPath && init?.method === "POST") {
          const body = (
            typeof init.body === "object" && init.body !== null
              ? init.body
              : JSON.parse(String(init.body))
          ) as {
            sql?: string;
            params?: unknown[];
          };
          if (
            body.sql?.includes("INSERT INTO reef_notifications") &&
            body.params?.[1] === fanoutRecipientB
          ) {
            throw new Error("intentional live partial fan-out failure");
          }
        }
        return adapter.request(path, init);
      },
    };

    const failedFanout = await akbProjectNotifications({
      adapter: failingAdapter,
      vault,
    });
    expect(failedFanout.activity.failed).toBe(true);
    const retriedFanout = await akbProjectNotifications({ adapter, vault });
    expect(retriedFanout.activity.failed).toBe(false);

    const fanoutNotifications = await akbListNotifications(adapter, vault, {
      recipient: fanoutRecipientA,
      limit: 100,
    });
    const secondActivityForA = fanoutNotifications.filter(
      (notification) =>
        notification.source_type === "activity" &&
        notification.occurred_at === secondTransitionAt,
    );
    expect(secondActivityForA).toHaveLength(1);
    const secondActivityNotification = secondActivityForA[0];
    if (!secondActivityNotification) {
      throw new Error("Live retry notification was not projected");
    }
    await akbUpdateNotificationState(adapter, vault, {
      notificationKey: secondActivityNotification.notification_key,
      recipient: fanoutRecipientA,
      state: "archived",
      changedAt: new Date(Date.now() + 3_000).toISOString(),
    });
    await akbProjectNotifications({ adapter, vault });
    const afterFanoutRetry = await akbListNotifications(adapter, vault, {
      recipient: fanoutRecipientA,
      limit: 100,
    });
    const preservedRetryNotification = afterFanoutRetry.filter(
      (notification) =>
        notification.notification_key ===
        secondActivityNotification.notification_key,
    );
    expect(preservedRetryNotification).toHaveLength(1);
    expect(preservedRetryNotification[0]?.state).toBe("archived");
  });

  it("change event tail — quiet vault receives heartbeat while another vault stays busy", async () => {
    const suffix =
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
        .padEnd(17, "0")
        .slice(0, 17);
    const busyVault = `reef-live-heartbeat-${suffix}`;
    const quietController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    try {
      await createVault({
        adapter,
        name: busyVault,
        description: "REEF Change Event heartbeat contract fixture",
      });
      await ensureReefTables({ adapter, vault: busyVault });

      const openedAt = Date.now();
      const response = await adapter.stream(
        `/api/v1/events/${encodeURIComponent(vault)}`,
        {
          query: { kind: "table.rows_changed" },
          signal: quietController.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")?.toLowerCase()).toContain(
        "text/event-stream",
      );
      if (!response.body) throw new Error("Live event stream has no body");
      const streamReader = response.body.getReader();
      reader = streamReader;

      const heartbeatRead = (async () => {
        const decoder = new TextDecoder();
        let buffered = "";
        while (!quietController.signal.aborted) {
          const { done, value } = await streamReader.read();
          if (done || !value) return false;
          buffered += decoder.decode(value, { stream: true });
          if (/(?:^|\r?\n):[ \t]*heartbeat\r?\n\r?\n/u.test(buffered)) {
            return true;
          }
          if (buffered.length > 256) buffered = buffered.slice(-64);
        }
        return false;
      })().catch(() => false);
      const heartbeatDeadline = new Promise<boolean>((resolve) => {
        heartbeatTimer = setTimeout(() => resolve(false), 20_000);
      });

      const busyUntil = openedAt + 18_000;
      let busyEvents = 0;
      const busyWrites = (async () => {
        while (Date.now() < busyUntil) {
          const at = new Date().toISOString();
          const eventKey = `heartbeat-contract:${suffix}:${busyEvents}`;
          await runSql(
            adapter,
            busyVault,
            "INSERT INTO reef_activity (reef_id, event_type, event_key, payload, meta) VALUES ($1, 'status_change', $2, $3::json, $4::json) RETURNING id",
            [
              `REEF-HEARTBEAT-${busyEvents}`,
              eventKey,
              JSON.stringify({ from: "todo", to: "in_progress" }),
              JSON.stringify({ actor: USERNAME, at, source: null }),
            ],
          );
          busyEvents += 1;
          await new Promise((resolve) => setTimeout(resolve, 2_500));
        }
      })();

      const heartbeatObserved = await Promise.race([
        heartbeatRead,
        heartbeatDeadline,
      ]);
      const heartbeatElapsedMs = Date.now() - openedAt;
      await busyWrites;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      expect(busyEvents).toBeGreaterThan(1);
      expect(heartbeatObserved).toBe(true);
      expect(heartbeatElapsedMs).toBeLessThanOrEqual(20_000);
    } finally {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      quietController.abort();
      await reader?.cancel().catch(() => undefined);
      await adapter
        .request(`/api/v1/vaults/${encodeURIComponent(busyVault)}`, {
          method: "DELETE",
          resource: `vault ${busyVault}`,
        })
        .catch(() => undefined);
    }
  }, 30_000);
});
