import { describe, expect, it } from "vitest";
import {
  AppReleaseManifestSchema,
  ReleaseBlueprintSchema,
  ReleaseManifestStepSchema,
} from "../../../schemas/controlPlane";
import {
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
} from "../core/tableManifest";
import {
  buildReleaseBlueprint,
  canonicalJson,
  canonicalTableProjection,
  finalizeAppReleaseManifest,
  sha256Hex,
  tableSchemaFingerprint,
  verifyFinalizedRelease,
} from "./releaseManifest";

const SOURCE_REVISION = "a".repeat(40);
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
const SCHEMA_V3_FINGERPRINT =
  "dada7b10e269e374dde943db7458dee3d5c1b69788778ea0a29169a16924a727";
const SCHEMA_V4_FINGERPRINT =
  "ec53a0d4dd7242e2f47c915f3e07c048044c9b68efc3383597d10df69244e080";

describe("Reef App Release Blueprint and Manifest v2", () => {
  it("projects the twelve-table schema and both v4 transition capabilities", async () => {
    const blueprint = await buildReleaseBlueprint();

    expect(blueprint.app_definition.app_key).toBe("reef");
    expect(REEF_SCHEMA_VERSION).toBe(4);
    expect(blueprint.schema_version).toBe(REEF_SCHEMA_VERSION);
    expect(blueprint.schema.tables).toHaveLength(12);
    expect(blueprint.schema.tables.map((table) => table.name)).toEqual(
      [...REEF_DESIRED_TABLES].map((table) => table.name).sort(),
    );
    expect(blueprint.schema.fingerprint).toBe(SCHEMA_V4_FINGERPRINT);

    const selectedTables = Object.fromEntries(
      blueprint.schema.tables
        .filter((table) =>
          [
            "reef_activity",
            "reef_attachments",
            "reef_comments",
            "reef_issues",
          ].includes(table.name),
        )
        .map((table) => [
          table.name,
          {
            unique_keys: table.unique_keys,
            indexes: table.indexes.map((index) => index.columns),
          },
        ]),
    );
    expect(selectedTables).toEqual({
      reef_activity: {
        unique_keys: [{ columns: ["reef_id", "event_key"] }],
        indexes: [
          [
            { name: "reef_id", order: "asc" },
            { name: "event_key", order: "asc" },
          ],
        ],
      },
      reef_attachments: {
        unique_keys: [],
        indexes: [[{ name: "reef_id", order: "asc" }]],
      },
      reef_comments: {
        unique_keys: [],
        indexes: [[{ name: "reef_id", order: "asc" }]],
      },
      reef_issues: {
        unique_keys: [],
        indexes: [
          [{ name: "document_uri", order: "asc" }],
          [{ name: "parent_id", order: "asc" }],
          [{ name: "reef_id", order: "asc" }],
          [{ name: "status", order: "asc" }],
        ],
      },
    });

    expect(blueprint.transition_plans).toHaveLength(4);
    const freshPlan = blueprint.transition_plans[0];
    if (!freshPlan || freshPlan.source !== "fresh") {
      throw new Error("expected the fresh install plan first");
    }
    expect(freshPlan.steps).toHaveLength(12);
    expect(
      freshPlan.steps.every(
        (step) =>
          step.operation === "create_table" &&
          step.phase === "expand" &&
          Object.keys(step.payload).sort().join(",") ===
            "columns,indexes,table,unique_keys",
      ),
    ).toBe(true);

    const freshActivityStep = freshPlan.steps.find(
      (step) =>
        step.operation === "create_table" &&
        step.payload.table === "reef_activity",
    );
    if (!freshActivityStep || freshActivityStep.operation !== "create_table") {
      throw new Error("expected the fresh reef_activity table step");
    }
    expect(freshActivityStep.payload.unique_keys).toEqual([
      { columns: ["reef_id", "event_key"] },
    ]);
    expect(
      freshActivityStep.payload.indexes.map((index) => index.columns),
    ).toEqual(selectedTables.reef_activity.indexes);

    const freshIssueStep = freshPlan.steps.find(
      (step) =>
        step.operation === "create_table" &&
        step.payload.table === "reef_issues",
    );
    if (!freshIssueStep || freshIssueStep.operation !== "create_table") {
      throw new Error("expected the fresh reef_issues table step");
    }
    expect(freshIssueStep.payload.indexes).toEqual(
      blueprint.schema.tables.find((table) => table.name === "reef_issues")
        ?.indexes,
    );

    const sourcePlans = blueprint.transition_plans.slice(1);
    expect(sourcePlans.map((plan) => plan.source)).toEqual([
      {
        release_version: "0.14.0",
        schema_fingerprint: SCHEMA_V3_FINGERPRINT,
      },
      {
        release_version: "0.15.0",
        schema_fingerprint: SCHEMA_V3_FINGERPRINT,
      },
      {
        release_version: "0.16.0",
        schema_fingerprint: SCHEMA_V3_FINGERPRINT,
      },
    ]);

    for (const plan of sourcePlans) {
      expect(plan.steps).toHaveLength(8);
      expect(plan.steps.map((step) => step.operation)).toEqual([
        "add_unique_key",
        "add_index",
        "add_index",
        "add_index",
        "add_index",
        "add_index",
        "add_index",
        "add_index",
      ]);
      const uniqueKeyStep = plan.steps[0];
      if (!uniqueKeyStep || uniqueKeyStep.operation !== "add_unique_key") {
        throw new Error("expected the activity event unique-key transition");
      }
      expect(uniqueKeyStep).toMatchObject({
        id: "add_reef_activity_event_key_unique_key",
        phase: "expand",
        payload: {
          table: "reef_activity",
          columns: ["reef_id", "event_key"],
        },
      });
      expect(uniqueKeyStep.checksum).toBe(
        "3cb937e3677402537707c15c8071c2b52df41292e4b1eb5fbb971da7d3bcaee9",
      );
      expect(
        plan.steps
          .filter((step) => step.operation === "add_index")
          .map((step) => [
            step.payload.table,
            step.payload.columns.map((column) => column.name),
          ]),
      ).toEqual([
        ["reef_activity", ["reef_id", "event_key"]],
        ["reef_attachments", ["reef_id"]],
        ["reef_comments", ["reef_id"]],
        ["reef_issues", ["document_uri"]],
        ["reef_issues", ["parent_id"]],
        ["reef_issues", ["reef_id"]],
        ["reef_issues", ["status"]],
      ]);
      for (const step of plan.steps) {
        expect(ReleaseManifestStepSchema.parse(step)).toEqual(step);
        const { checksum, ...checksumInput } = step;
        expect(checksum).toBe(await sha256Hex(canonicalJson(checksumInput)));
      }
    }
  });

  it("normalizes column, key, and index ordering independently of input order", async () => {
    const first = canonicalTableProjection({
      name: "orders",
      columns: [
        { name: "payload", type: "jsonb" },
        { name: "amount", type: "numeric" },
      ],
      unique_keys: [{ name: "physical_b", columns: ["amount"] }],
      indexes: [{ name: "physical_i", columns: ["payload"] }],
    });
    const second = canonicalTableProjection({
      name: "orders",
      columns: [
        { name: "amount", type: "numeric" },
        { name: "payload", type: "jsonb" },
      ],
      unique_keys: [{ name: "physical_a", columns: ["amount"] }],
      indexes: [
        {
          name: "physical_j",
          columns: [{ name: "payload", order: "asc" }],
        },
      ],
    });

    expect(first).toEqual(second);
    expect(first).toEqual({
      name: "orders",
      columns: [
        { name: "amount", type: "numeric" },
        { name: "payload", type: "jsonb" },
      ],
      unique_keys: [{ columns: ["amount"] }],
      indexes: [{ columns: [{ name: "payload", order: "asc" }] }],
    });
    expect(await tableSchemaFingerprint([first])).toBe(
      await tableSchemaFingerprint([second]),
    );
  });

  it("uses NFC, sorted object keys, and compact UTF-8 JSON", () => {
    expect(
      canonicalJson({
        z: "e\u0301",
        a: { z: true, a: "값" },
      }),
    ).toBe('{"a":{"a":"값","z":true},"z":"é"}');
  });

  it("finalizes a deterministic strict v2 release payload", async () => {
    const blueprint = await buildReleaseBlueprint();
    const first = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });
    const second = await finalizeAppReleaseManifest({
      blueprint: structuredClone(blueprint),
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.manifest_checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(AppReleaseManifestSchema.parse(first.manifest)).toEqual(
      first.manifest,
    );
    expect(first.manifest).toMatchObject({
      manifest_version: 2,
      app_key: "reef",
      source_revision: SOURCE_REVISION,
      image_digest: IMAGE_DIGEST,
      schema_version: REEF_SCHEMA_VERSION,
    });
    expect(first.manifest.transition_plans).toHaveLength(4);
    expect(
      first.manifest.transition_plans[0]?.steps.every((step) =>
        /^[0-9a-f]{64}$/u.test(step.checksum),
      ),
    ).toBe(true);
    expect(first.manifest.transition_plans[1]?.steps).toHaveLength(8);
    expect(first.manifest.transition_plans[3]?.source).toEqual({
      release_version: "0.16.0",
      schema_fingerprint: SCHEMA_V3_FINGERPRINT,
    });
    expect(first.manifest.transition_plans[3]?.steps).toEqual(
      first.manifest.transition_plans[1]?.steps,
    );
  });

  it("keeps mutable app display metadata outside the release checksum", async () => {
    const blueprint = await buildReleaseBlueprint();
    const changedMetadata = {
      ...blueprint,
      app_definition: {
        ...blueprint.app_definition,
        display_name: "A different display name",
        description: "A different mutable description",
      },
    };
    const first = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });
    const second = await finalizeAppReleaseManifest({
      blueprint: changedMetadata,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });

    expect(second.manifest_checksum).toBe(first.manifest_checksum);
  });

  it("binds product version and every provenance field into the checksum", async () => {
    const blueprint = await buildReleaseBlueprint();
    const base = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });
    const sourceChanged = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: "c".repeat(40),
      imageDigest: IMAGE_DIGEST,
    });
    const imageChanged = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: `sha256:${"d".repeat(64)}`,
    });
    const versionChanged = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.14.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });

    expect(
      new Set([
        base.manifest_checksum,
        sourceChanged.manifest_checksum,
        imageChanged.manifest_checksum,
        versionChanged.manifest_checksum,
      ]).size,
    ).toBe(4);
  });

  it.each([
    ["version", { version: "0.13" }],
    ["source revision", { sourceRevision: "short" }],
    ["image tag", { imageDigest: "reef:latest" }],
    ["malformed image digest", { imageDigest: "sha256:ABC" }],
  ])("rejects an invalid %s before finalization", async (_label, overrides) => {
    const blueprint = await buildReleaseBlueprint();
    await expect(
      finalizeAppReleaseManifest({
        blueprint,
        version: "0.13.0",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
        ...overrides,
      }),
    ).rejects.toThrow();
  });

  it("rejects stale blueprints and schema-version drift", async () => {
    const blueprint = await buildReleaseBlueprint();
    const stale = structuredClone(blueprint);
    const staleTable = stale.schema.tables[0];
    if (!staleTable) throw new Error("expected a desired table");
    const staleColumn = staleTable.columns[0];
    if (!staleColumn) throw new Error("expected a desired column");
    staleTable.columns[0] = {
      ...staleColumn,
      type: "numeric",
    };
    const wrongVersion = {
      ...blueprint,
      schema_version: REEF_SCHEMA_VERSION - 1,
    };

    await expect(
      finalizeAppReleaseManifest({
        blueprint: stale,
        version: "0.13.0",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();
    await expect(
      finalizeAppReleaseManifest({
        blueprint: wrongVersion,
        version: "0.13.0",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();
  });

  it("accepts only explicit schema transition sources and complete plans", async () => {
    const blueprint = await buildReleaseBlueprint();
    const mismatch = structuredClone(blueprint);
    const mismatchPlan = mismatch.transition_plans[1];
    if (!mismatchPlan || mismatchPlan.source === "fresh") {
      throw new Error("expected a v3 source transition plan");
    }
    mismatchPlan.source.schema_fingerprint = "f".repeat(64);
    await expect(
      finalizeAppReleaseManifest({
        blueprint: mismatch,
        version: "0.14.1",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const malformedPlan = structuredClone(blueprint);
    const sourcePlan = malformedPlan.transition_plans[1];
    if (!sourcePlan || sourcePlan.source === "fresh") {
      throw new Error("expected a v3 source transition plan");
    }
    const sourceStep = sourcePlan.steps[0];
    if (!sourceStep || sourceStep.operation !== "add_unique_key") {
      throw new Error("expected an add-unique-key step");
    }
    sourceStep.payload.columns = ["event_key"];
    await expect(
      finalizeAppReleaseManifest({
        blueprint: malformedPlan,
        version: "0.14.1",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const incompletePlan = structuredClone(blueprint);
    const incompleteSourcePlan = incompletePlan.transition_plans[1];
    if (!incompleteSourcePlan || incompleteSourcePlan.source === "fresh") {
      throw new Error("expected a v3 source transition plan");
    }
    incompleteSourcePlan.steps.pop();
    await expect(
      finalizeAppReleaseManifest({
        blueprint: incompletePlan,
        version: "0.14.1",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const duplicate = structuredClone(blueprint);
    duplicate.transition_plans.push(
      structuredClone(duplicate.transition_plans[1]),
    );
    await expect(
      finalizeAppReleaseManifest({
        blueprint: duplicate,
        version: "0.14.1",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const unknown = structuredClone(blueprint);
    unknown.transition_plans.push({
      source: {
        release_version: "0.13.0",
        schema_fingerprint: blueprint.schema.fingerprint,
      },
      steps: [],
    });
    await expect(
      finalizeAppReleaseManifest({
        blueprint: unknown,
        version: "0.14.1",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown/destructive steps and checksum mismatches", async () => {
    const blueprint = await buildReleaseBlueprint();
    const invalid = structuredClone(blueprint);
    const invalidPlan = invalid.transition_plans[0];
    if (!invalidPlan) throw new Error("expected a transition plan");
    const invalidStep = invalidPlan.steps[0];
    if (!invalidStep) throw new Error("expected a transition step");
    invalidPlan.steps[0] = {
      ...invalidStep,
      operation: "drop_table",
      raw_sql: "DROP TABLE reef_issues",
    } as never;

    await expect(
      finalizeAppReleaseManifest({
        blueprint: invalid,
        version: "0.13.0",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const addIndexPlan = blueprint.transition_plans[1];
    const addIndexStep = addIndexPlan?.steps[1];
    if (!addIndexStep || addIndexStep.operation !== "add_index") {
      throw new Error("expected a schema add_index step");
    }
    expect(
      ReleaseManifestStepSchema.safeParse({
        ...addIndexStep,
        phase: "backfill",
      }).success,
    ).toBe(false);
    expect(
      ReleaseManifestStepSchema.safeParse({
        ...addIndexStep,
        payload: { ...addIndexStep.payload, columns: [] },
      }).success,
    ).toBe(false);
    expect(
      ReleaseManifestStepSchema.safeParse({
        ...addIndexStep,
        payload: {
          ...addIndexStep.payload,
          columns: [
            ...addIndexStep.payload.columns,
            addIndexStep.payload.columns[0],
          ],
        },
      }).success,
    ).toBe(false);

    const invalidStepChecksum = structuredClone(blueprint);
    const checksumPlan = invalidStepChecksum.transition_plans[1];
    const checksumStep = checksumPlan?.steps[1];
    if (!checksumStep) throw new Error("expected an add_index step");
    checksumStep.checksum = "f".repeat(64);
    await expect(
      finalizeAppReleaseManifest({
        blueprint: invalidStepChecksum,
        version: "0.13.0",
        sourceRevision: SOURCE_REVISION,
        imageDigest: IMAGE_DIGEST,
      }),
    ).rejects.toThrow();

    const finalized = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });
    await expect(
      verifyFinalizedRelease({
        ...finalized,
        manifest_checksum: "f".repeat(64),
      }),
    ).rejects.toThrow();
  });

  it("fails closed when the finalized manifest is mutated after signing", async () => {
    const blueprint = await buildReleaseBlueprint();
    const finalized = await finalizeAppReleaseManifest({
      blueprint,
      version: "0.13.0",
      sourceRevision: SOURCE_REVISION,
      imageDigest: IMAGE_DIGEST,
    });
    const mutated = structuredClone(finalized);
    mutated.manifest.image_digest = `sha256:${"c".repeat(64)}`;

    await expect(verifyFinalizedRelease(mutated)).rejects.toThrow();
  });

  it("validates the committed blueprint shape strictly", async () => {
    const blueprint = await buildReleaseBlueprint();
    expect(ReleaseBlueprintSchema.parse(blueprint)).toEqual(blueprint);
    expect(() =>
      ReleaseBlueprintSchema.parse({ ...blueprint, unexpected: true }),
    ).toThrow();
  });
});
