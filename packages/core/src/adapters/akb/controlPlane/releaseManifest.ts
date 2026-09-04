import type { z } from "zod";
import { SchemaValidationError } from "../../../errors";
import {
  AppReleaseManifestSchema,
  FinalizedReleasePayloadSchema,
  ReefAppDefinitionSchema,
  ReleaseBlueprintSchema,
  ReleaseSourceRevisionSchema,
  ReleaseVersionSchema,
  ReleaseImageDigestSchema,
  ReleaseManifestTableSchema,
  type AppReleaseManifest,
  type FinalizedReleasePayload,
  type ReleaseBlueprint,
  type ReleaseCreateTablePayload,
  type ReleaseDesiredSchemaProjection,
  type ReleaseManifestStep,
  type ReleaseManifestTable,
  type ReleaseTransitionSource,
} from "../../../schemas/controlPlane";
import {
  canonicalReefTableProjection,
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
  type ReefTableProjectionInput,
} from "../core/tableManifest";

const REEF_TABLE_COUNT = 12;
const REEF_BASELINE_RELEASE_VERSION = "0.14.0";
const REEF_BASELINE_SCHEMA_FINGERPRINT =
  "dada7b10e269e374dde943db7458dee3d5c1b69788778ea0a29169a16924a727";

/** Explicit source releases that may use the schema no-op transition. */
export const REEF_SUPPORTED_TRANSITION_SOURCES: readonly ReleaseTransitionSource[] =
  Object.freeze([
    Object.freeze({
      release_version: REEF_BASELINE_RELEASE_VERSION,
      schema_fingerprint: REEF_BASELINE_SCHEMA_FINGERPRINT,
    }),
  ]);

/** Mutable display metadata is intentionally not part of a release checksum. */
export const REEF_APP_DEFINITION = Object.freeze(
  ReefAppDefinitionSchema.parse({
    app_key: "reef",
    display_name: "Reef",
    description: "Reef project management workspace",
  }),
);

type TableSchemaInput = ReefTableProjectionInput;

type JsonObject = Record<string, unknown>;

function releaseValidationError(message: string): SchemaValidationError {
  return new SchemaValidationError({
    field: "release artifact",
    clientValidated: true,
    issues: [message],
  });
}

function parseReleaseValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new SchemaValidationError({
    field: label,
    clientValidated: true,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || label}: ${issue.message}`,
    ),
  });
}

function canonicalJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? value.normalize("NFC") : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw releaseValidationError(
        "Release JSON cannot contain non-finite numbers",
      );
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object") {
    throw releaseValidationError("Release JSON contains an unsupported value");
  }

  const entries = Object.entries(value).map(
    ([key, nested]) =>
      [key.normalize("NFC"), canonicalJsonValue(nested)] as const,
  );
  const keys = new Set<string>();
  for (const [key] of entries) {
    if (keys.has(key)) {
      throw releaseValidationError(
        "Release JSON contains duplicate normalized keys",
      );
    }
    keys.add(key);
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const normalized: JsonObject = Object.create(null) as JsonObject;
  for (const [key, nested] of entries) normalized[key] = nested;
  return normalized;
}

/** AKB-compatible NFC-normalized, sorted-key, compact JSON. */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalJsonValue(value));
  if (serialized === undefined) {
    throw releaseValidationError("Release JSON could not be serialized");
  }
  return serialized;
}

/** SHA-256 for canonical release data using the platform Web Crypto API. */
export async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is required for release artifacts");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert one Reef/AKB table declaration to AKB's logical fingerprint shape.
 * Physical constraint and index names are deliberately excluded.
 */
export function canonicalTableProjection(
  table: TableSchemaInput,
): ReleaseManifestTable {
  return ReleaseManifestTableSchema.parse(canonicalReefTableProjection(table));
}

/** Return the AKB canonical fingerprint for an explicit table collection. */
export async function tableSchemaFingerprint(
  tables: Iterable<TableSchemaInput>,
): Promise<string> {
  const descriptors = [...tables]
    .map(canonicalTableProjection)
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  return sha256Hex(canonicalJson(descriptors));
}

export async function buildDesiredSchemaProjection(): Promise<ReleaseDesiredSchemaProjection> {
  const tables = REEF_DESIRED_TABLES.map(canonicalTableProjection).sort(
    (left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  if (tables.length !== REEF_TABLE_COUNT) {
    throw releaseValidationError(
      `Reef release schema must contain exactly ${REEF_TABLE_COUNT} tables`,
    );
  }
  return {
    tables,
    fingerprint: await tableSchemaFingerprint(tables),
  };
}

function createTablePayload(
  table: ReleaseManifestTable,
): ReleaseCreateTablePayload {
  return {
    table: table.name,
    columns: table.columns,
    unique_keys: table.unique_keys,
    indexes: table.indexes,
  };
}

function stepWithoutChecksum(
  step: ReleaseManifestStep | JsonObject,
): JsonObject {
  return Object.fromEntries(
    Object.entries(step).filter(([key]) => key !== "checksum"),
  );
}

async function createTableStep(
  table: ReleaseManifestTable,
): Promise<ReleaseManifestStep> {
  const stepWithoutDigest = {
    id: `create_${table.name}`,
    phase: "expand" as const,
    operation: "create_table" as const,
    payload: createTablePayload(table),
  };
  return {
    ...stepWithoutDigest,
    checksum: await sha256Hex(canonicalJson(stepWithoutDigest)),
  };
}

function releaseBoundBlueprint(blueprint: ReleaseBlueprint): JsonObject {
  return {
    app_key: blueprint.app_definition.app_key,
    schema_version: blueprint.schema_version,
    schema: blueprint.schema,
    transition_plans: blueprint.transition_plans,
  };
}

async function parseCurrentBlueprint(
  value: unknown,
): Promise<ReleaseBlueprint> {
  const blueprint = parseReleaseValue(
    ReleaseBlueprintSchema,
    value,
    "release blueprint",
  );
  if (blueprint.schema_version !== REEF_SCHEMA_VERSION) {
    throw releaseValidationError("Release Blueprint schema version is stale");
  }
  const desired = await buildReleaseBlueprint();
  if (
    canonicalJson(releaseBoundBlueprint(blueprint)) !==
    canonicalJson(releaseBoundBlueprint(desired))
  ) {
    throw releaseValidationError(
      "Release Blueprint is stale or differs from the Reef schema SSOT",
    );
  }
  return blueprint;
}

/** Build the source-committed current Reef v3 release blueprint. */
export async function buildReleaseBlueprint(): Promise<ReleaseBlueprint> {
  const schema = await buildDesiredSchemaProjection();
  const steps = await Promise.all(schema.tables.map(createTableStep));
  for (const source of REEF_SUPPORTED_TRANSITION_SOURCES) {
    if (source.schema_fingerprint !== schema.fingerprint) {
      throw releaseValidationError(
        `Supported transition source ${source.release_version} does not match the desired schema fingerprint`,
      );
    }
  }
  return ReleaseBlueprintSchema.parse({
    app_definition: { ...REEF_APP_DEFINITION },
    schema_version: REEF_SCHEMA_VERSION,
    schema,
    transition_plans: [
      { source: "fresh", steps },
      ...[...REEF_SUPPORTED_TRANSITION_SOURCES]
        .sort((left, right) =>
          canonicalJson(left) < canonicalJson(right)
            ? -1
            : canonicalJson(left) > canonicalJson(right)
              ? 1
              : 0,
        )
        .map((source) => ({ source, steps: [] })),
    ],
  });
}

function manifestChecksumInput(
  manifest: AppReleaseManifest,
  version: string,
): JsonObject {
  return {
    manifest_version: manifest.manifest_version,
    app_key: manifest.app_key,
    source_revision: manifest.source_revision,
    image_digest: manifest.image_digest,
    schema_version: manifest.schema_version,
    schema: manifest.schema,
    transition_plans: manifest.transition_plans.map((plan) => ({
      source: plan.source,
      steps: plan.steps.map(stepWithoutChecksum),
    })),
    product_version: version,
  };
}

/** Compute the AKB App Release Manifest v2 checksum for a product version. */
export async function calculateReleaseManifestChecksum(
  manifest: AppReleaseManifest,
  version: string,
): Promise<string> {
  const parsedVersion = parseReleaseValue(
    ReleaseVersionSchema,
    version,
    "version",
  );
  return sha256Hex(
    canonicalJson(manifestChecksumInput(manifest, parsedVersion)),
  );
}

export interface FinalizeAppReleaseManifestInput {
  blueprint: unknown;
  version: string;
  sourceRevision: string;
  imageDigest: string;
}

/**
 * Combine a current Blueprint with product/build provenance into the exact
 * release payload accepted by AKB. This function performs no I/O.
 */
export async function finalizeAppReleaseManifest(
  input: FinalizeAppReleaseManifestInput,
): Promise<FinalizedReleasePayload> {
  const blueprint = await parseCurrentBlueprint(input.blueprint);
  const version = parseReleaseValue(
    ReleaseVersionSchema,
    input.version,
    "version",
  );
  const sourceRevision = parseReleaseValue(
    ReleaseSourceRevisionSchema,
    input.sourceRevision,
    "source revision",
  ).toLowerCase();
  const imageDigest = parseReleaseValue(
    ReleaseImageDigestSchema,
    input.imageDigest,
    "image digest",
  );

  const manifest = AppReleaseManifestSchema.parse({
    manifest_version: 2,
    app_key: blueprint.app_definition.app_key,
    source_revision: sourceRevision,
    image_digest: imageDigest,
    schema_version: blueprint.schema_version,
    schema: blueprint.schema,
    transition_plans: blueprint.transition_plans.map((plan) => ({
      source: plan.source,
      steps: plan.steps,
    })),
  });
  const manifestChecksum = await calculateReleaseManifestChecksum(
    manifest,
    version,
  );
  return {
    version,
    manifest,
    manifest_checksum: manifestChecksum,
  };
}

/** Verify a release payload before it is passed to a registry/release writer. */
export async function verifyFinalizedRelease(
  value: unknown,
): Promise<FinalizedReleasePayload> {
  const payload = parseReleaseValue(
    FinalizedReleasePayloadSchema,
    value,
    "finalized release",
  );
  const expected = await finalizeAppReleaseManifest({
    blueprint: await buildReleaseBlueprint(),
    version: payload.version,
    sourceRevision: payload.manifest.source_revision,
    imageDigest: payload.manifest.image_digest,
  });
  if (canonicalJson(payload.manifest) !== canonicalJson(expected.manifest)) {
    throw releaseValidationError(
      "Finalized App Release Manifest does not match its canonical form",
    );
  }
  if (payload.manifest_checksum !== expected.manifest_checksum) {
    throw releaseValidationError(
      "Finalized App Release Manifest checksum mismatch",
    );
  }
  return expected;
}
