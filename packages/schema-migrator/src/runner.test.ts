import { afterEach, describe, expect, it, vi } from "vitest";
import { defineMigrationCatalog } from "./catalog";
import {
  MigrationRunError,
  type MigrationRuntime,
  createCoreMigrationRuntime,
  runSchemaMigrations,
} from "./runner";

const PHASE = "018f47a4-8e3b-7f62-a3d2-9876543210ab";
const SERVICE_ACCOUNT = "reef-migrator";

afterEach(() => {
  vi.unstubAllGlobals();
});

function runtime(overrides: Partial<MigrationRuntime> = {}): MigrationRuntime {
  return {
    getIdentity: vi.fn().mockResolvedValue({
      username: SERVICE_ACCOUNT,
      isAdmin: false,
      keyClass: "service",
      tokenScopes: ["read", "write"],
    }),
    listVaults: vi
      .fn()
      .mockResolvedValue([
        { name: "reef-b" },
        { name: "raw" },
        { name: "reef-a" },
      ]),
    inspectWorkspace: vi.fn().mockImplementation(async (vault: string) => ({
      isReef: vault !== "raw",
      initializationPending: false,
      members: [{ username: SERVICE_ACCOUNT, role: "writer" }],
    })),
    readSchemaVersion: vi.fn().mockResolvedValue(1),
    applyPhase: vi.fn().mockResolvedValue({ applied: true, checksum: "abc" }),
    ensureTables: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const onePhase = defineMigrationCatalog([
  {
    fromVersion: 0,
    toVersion: 1,
    idempotencyKey: PHASE,
    operations: [
      {
        op: "add_column",
        table: "reef_issues",
        column: { name: "future", type: "text" },
      },
    ],
  },
]);

describe("schema migration runner", () => {
  it("matches the active service token using the upstream-provided prefix length", async () => {
    const serviceKey = "akb_secret_variable_prefix_key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        const payload = url.endsWith("/api/v1/auth/me")
          ? {
              username: SERVICE_ACCOUNT,
              is_admin: false,
              key_class: "service",
            }
          : {
              tokens: [
                {
                  token_id: "018f47a4-8e3b-7f62-a3d2-9876543210ad",
                  prefix: "akb_secret_variable",
                  scopes: ["read", "write"],
                  key_class: "service",
                },
              ],
            };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(
      createCoreMigrationRuntime({
        akbBaseUrl: "https://akb.test",
        serviceKey,
        serviceAccount: SERVICE_ACCOUNT,
      }).getIdentity(),
    ).resolves.toMatchObject({ tokenScopes: ["read", "write"] });
  });

  it("preflights the complete sorted inventory before an empty-catalog final verification", async () => {
    const events: string[] = [];
    const subject = runtime({
      inspectWorkspace: vi.fn().mockImplementation(async (vault: string) => {
        events.push(`inspect:${vault}`);
        return {
          isReef: vault !== "raw",
          initializationPending: false,
          members: [{ username: SERVICE_ACCOUNT, role: "writer" }],
        };
      }),
      ensureTables: vi.fn().mockImplementation(async (vault: string) => {
        events.push(`ensure:${vault}`);
      }),
    });

    const report = await runSchemaMigrations({
      runtime: subject,
      serviceAccount: SERVICE_ACCOUNT,
    });

    expect(events).toEqual([
      "inspect:raw",
      "inspect:reef-a",
      "inspect:reef-b",
      "ensure:reef-a",
      "ensure:reef-b",
    ]);
    expect(subject.applyPhase).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      ok: true,
      counts: { discovered: 3, reef: 2, rawSkipped: 1, completed: 2 },
      workspaces: [
        { vault: "reef-a", status: "no_op", phases: [] },
        { vault: "reef-b", status: "no_op", phases: [] },
      ],
    });
  });

  it.each([
    {
      username: "somebody-else",
      isAdmin: false,
      keyClass: "service",
      tokenScopes: ["read", "write"],
    },
    {
      username: SERVICE_ACCOUNT,
      isAdmin: true,
      keyClass: "service",
      tokenScopes: ["read", "write"],
    },
    {
      username: SERVICE_ACCOUNT,
      isAdmin: false,
      keyClass: "pat",
      tokenScopes: ["read", "write"],
    },
    {
      username: SERVICE_ACCOUNT,
      isAdmin: false,
      keyClass: "service",
      tokenScopes: ["read"],
    },
    {
      username: SERVICE_ACCOUNT,
      isAdmin: false,
      keyClass: "service",
      tokenScopes: ["read", "write", "admin"],
    },
  ])(
    "rejects a mismatched identity or a credential without exact read+write scopes",
    async (identity) => {
      const subject = runtime({
        getIdentity: vi.fn().mockResolvedValue(identity),
      });
      await expect(
        runSchemaMigrations({
          runtime: subject,
          serviceAccount: SERVICE_ACCOUNT,
        }),
      ).rejects.toMatchObject({ message: "identity_invalid" });
      expect(subject.listVaults).not.toHaveBeenCalled();
    },
  );

  it("fails preflight before any mutation when one Reef membership is not exactly writer", async () => {
    const subject = runtime({
      inspectWorkspace: vi.fn().mockImplementation(async (vault: string) => ({
        isReef: vault !== "raw",
        initializationPending: false,
        members: [
          {
            username: SERVICE_ACCOUNT,
            role: vault === "reef-b" ? "reader" : "writer",
          },
        ],
      })),
    });
    await expect(
      runSchemaMigrations({
        runtime: subject,
        serviceAccount: SERVICE_ACCOUNT,
      }),
    ).rejects.toMatchObject({
      message: "preflight_failed",
      report: { counts: { completed: 0 }, failure: { vault: "reef-b" } },
    });
    expect(subject.readSchemaVersion).not.toHaveBeenCalled();
    expect(subject.applyPhase).not.toHaveBeenCalled();
    expect(subject.ensureTables).not.toHaveBeenCalled();
  });

  it("fails preflight for a durable skill stamp without a completed Reef marker", async () => {
    const subject = runtime({
      inspectWorkspace: vi.fn().mockImplementation(async (vault: string) => ({
        isReef: vault !== "raw",
        initializationPending: vault === "raw",
        members: [{ username: SERVICE_ACCOUNT, role: "writer" }],
      })),
    });

    await expect(
      runSchemaMigrations({
        runtime: subject,
        serviceAccount: SERVICE_ACCOUNT,
      }),
    ).rejects.toMatchObject({
      message: "preflight_failed",
      report: { failure: { vault: "raw" } },
    });
    expect(subject.readSchemaVersion).not.toHaveBeenCalled();
    expect(subject.applyPhase).not.toHaveBeenCalled();
    expect(subject.ensureTables).not.toHaveBeenCalled();
  });

  it("preserves fixed phase replay and checksum observables", async () => {
    const subject = runtime({
      listVaults: vi.fn().mockResolvedValue([{ name: "reef-a" }]),
      readSchemaVersion: vi.fn().mockResolvedValue(0),
      applyPhase: vi
        .fn()
        .mockResolvedValue({ applied: false, checksum: "fixed" }),
    });
    const report = await runSchemaMigrations({
      runtime: subject,
      serviceAccount: SERVICE_ACCOUNT,
      catalog: onePhase,
    });
    expect(subject.applyPhase).toHaveBeenCalledWith(
      "reef-a",
      PHASE,
      onePhase[0]?.operations,
    );
    expect(report.workspaces[0]).toEqual({
      vault: "reef-a",
      status: "no_op",
      phases: [{ phaseId: PHASE, applied: false, checksum: "fixed" }],
    });
  });

  it("stops after a partial workspace failure and converges on retry", async () => {
    const applied = new Set<string>();
    let failOnce = true;
    const makeRuntime = () =>
      runtime({
        listVaults: vi
          .fn()
          .mockResolvedValue([
            { name: "reef-a" },
            { name: "reef-b" },
            { name: "reef-c" },
          ]),
        readSchemaVersion: vi.fn().mockResolvedValue(0),
        applyPhase: vi.fn().mockImplementation(async (vault: string) => {
          if (vault === "reef-b" && failOnce) {
            failOnce = false;
            throw new Error("injected raw failure");
          }
          const first = !applied.has(vault);
          applied.add(vault);
          return { applied: first, checksum: "stable" };
        }),
      });

    const first = makeRuntime();
    await expect(
      runSchemaMigrations({
        runtime: first,
        serviceAccount: SERVICE_ACCOUNT,
        catalog: onePhase,
      }),
    ).rejects.toMatchObject({
      message: "migration_failed",
      report: {
        counts: { completed: 1 },
        failure: { vault: "reef-b", phaseId: PHASE },
      },
    });
    expect(first.applyPhase).not.toHaveBeenCalledWith(
      "reef-c",
      expect.anything(),
      expect.anything(),
    );

    const retry = makeRuntime();
    const report = await runSchemaMigrations({
      runtime: retry,
      serviceAccount: SERVICE_ACCOUNT,
      catalog: onePhase,
    });
    expect(report.ok).toBe(true);
    expect(report.counts.completed).toBe(3);
    expect(report.workspaces.map((workspace) => workspace.status)).toEqual([
      "no_op",
      "applied",
      "applied",
    ]);
  });

  it("never exposes a credential-bearing cause in throwable or report", async () => {
    const sentinel = "REEF_SENTINEL_SUPER_SECRET";
    const subject = runtime({
      inspectWorkspace: vi
        .fn()
        .mockRejectedValue(new Error(`Authorization: Bearer ${sentinel}`)),
    });
    let caught: unknown;
    try {
      await runSchemaMigrations({
        runtime: subject,
        serviceAccount: SERVICE_ACCOUNT,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MigrationRunError);
    expect(JSON.stringify(caught)).not.toContain(sentinel);
    expect(String(caught)).not.toContain(sentinel);
    expect(JSON.stringify((caught as MigrationRunError).report)).not.toContain(
      sentinel,
    );
  });
});
