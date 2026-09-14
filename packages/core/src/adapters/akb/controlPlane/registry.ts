import { z } from "zod";
import { type ControlPlaneError, SchemaValidationError } from "../../../errors";
import {
  AppReleaseManifestSchema,
  ControlPlaneAppDefinitionSchema,
  ControlPlaneAppReleaseSchema,
  ControlPlaneIdSchema,
  ReleaseDesiredSchemaProjectionSchema,
  ReleaseManifestColumnSchema,
  ReleaseManifestIndexColumnSchema,
  ReleaseManifestIndexSchema,
  ReleaseManifestTableSchema,
  ReleaseManifestUniqueKeySchema,
  type ControlPlaneAppDefinition,
  type ControlPlaneAppRelease,
  type FinalizedReleasePayload,
} from "../../../schemas/controlPlane";
import {
  controlPlaneError,
  normalizeControlPlaneBaseUrl,
  requestControlPlaneJson,
  withControlPlaneSpan,
  type ControlPlaneRequestPolicy,
  type ControlPlaneTokenSource,
  validateControlPlaneRequestPolicy,
  validateControlPlaneTokenSource,
} from "./http";
import {
  REEF_APP_DEFINITION,
  canonicalJson,
  verifyFinalizedRelease,
} from "./releaseManifest";

const CREATE_APP_OPERATION = "apps.create";
const GET_APP_OPERATION = "apps.get";
const CREATE_RELEASE_OPERATION = "apps.releases.create";
const GET_RELEASE_OPERATION = "apps.releases.get";

/**
 * AKB's release response currently decorates canonical schema entries with
 * explicit defaults. Accept only those documented wire defaults, then project
 * back through the strict Reef schemas so meaningful fields cannot disappear.
 */
const WireReleaseManifestColumnSchema = z
  .strictObject({
    name: ReleaseManifestColumnSchema.shape.name,
    type: ReleaseManifestColumnSchema.shape.type,
    required: ReleaseManifestColumnSchema.shape.required,
    default: z.null().optional(),
    check: z.null().optional(),
    enum: z.null().optional(),
    references: z.null().optional(),
    on_delete: z.null().optional(),
    unique: z.literal(false).optional(),
    index: z.literal(false).optional(),
  })
  .transform(({ name, type, required }) =>
    ReleaseManifestColumnSchema.parse({
      name,
      type,
      ...(required === true ? { required: true } : {}),
    }),
  );

const WireReleaseManifestUniqueKeySchema = z
  .strictObject({
    columns: ReleaseManifestUniqueKeySchema.shape.columns,
    name: z.null().optional(),
  })
  .transform(({ columns }) =>
    ReleaseManifestUniqueKeySchema.parse({ columns }),
  );

const WireReleaseManifestIndexColumnSchema = z
  .strictObject({
    name: ReleaseManifestIndexColumnSchema.shape.name,
    order: ReleaseManifestIndexColumnSchema.shape.order,
  })
  .transform(({ name, order }) =>
    ReleaseManifestIndexColumnSchema.parse({ name, order }),
  );

const WireReleaseManifestIndexSchema = z
  .strictObject({
    columns: z.array(WireReleaseManifestIndexColumnSchema).min(1).max(256),
    name: z.null().optional(),
  })
  .transform(({ columns }) => ReleaseManifestIndexSchema.parse({ columns }));

const WireReleaseManifestTableSchema = z
  .strictObject({
    name: ReleaseManifestTableSchema.shape.name,
    columns: z.array(WireReleaseManifestColumnSchema).max(256),
    unique_keys: z.array(WireReleaseManifestUniqueKeySchema).max(256),
    indexes: z.array(WireReleaseManifestIndexSchema).max(256),
  })
  .transform((table) => ReleaseManifestTableSchema.parse(table));

const WireReleaseDesiredSchemaProjectionSchema = z
  .strictObject({
    tables: z.array(WireReleaseManifestTableSchema).length(12),
    fingerprint: ReleaseDesiredSchemaProjectionSchema.shape.fingerprint,
  })
  .transform((schema) => ReleaseDesiredSchemaProjectionSchema.parse(schema));

const WireAppReleaseManifestSchema = z
  .strictObject({
    ...AppReleaseManifestSchema.shape,
    schema: WireReleaseDesiredSchemaProjectionSchema,
  })
  .transform((manifest) => AppReleaseManifestSchema.parse(manifest));

const WireAppDefinitionSchema = z.looseObject({
  id: ControlPlaneIdSchema,
  app_key: z.string().min(1),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  replayed: z.boolean().nullable().optional(),
});

const WireAppReleaseSchema = z.strictObject({
  id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  version: z.string().min(1),
  manifest: WireAppReleaseManifestSchema,
  manifest_checksum: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/u),
  registered_at: z.string().min(1),
  replayed: z.boolean().nullable().optional(),
});

export interface AkbAppRegistryConfig {
  baseUrl: string;
  adminToken: ControlPlaneTokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface AkbAppRegistry {
  readonly createApp: () => Promise<ControlPlaneAppDefinition>;
  readonly getApp: (appId: string) => Promise<ControlPlaneAppDefinition>;
  readonly createRelease: (
    input: FinalizedReleasePayload & { appId: string },
  ) => Promise<ControlPlaneAppRelease>;
  readonly getRelease: (
    appId: string,
    releaseId: string,
  ) => Promise<ControlPlaneAppRelease>;
}

function parseId(value: string, field: string): string {
  const parsed = ControlPlaneIdSchema.safeParse(value);
  if (parsed.success) return parsed.data.toLowerCase();
  throw new SchemaValidationError({
    field,
    clientValidated: true,
    issues: [`${field} must be a UUID`],
  });
}

function registryError(
  operation: string,
  context: Omit<
    ConstructorParameters<typeof ControlPlaneError>[0],
    "operation"
  >,
): ControlPlaneError {
  return controlPlaneError(operation, context);
}

function mapApp(value: unknown, operation: string): ControlPlaneAppDefinition {
  const wire = WireAppDefinitionSchema.safeParse(value);
  if (!wire.success) {
    throw registryError(operation, {
      category: "invalid_response",
      upstreamStatus: 200,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  try {
    const replayed =
      wire.data.replayed === null ? undefined : wire.data.replayed;
    return ControlPlaneAppDefinitionSchema.parse({
      id: wire.data.id,
      appKey: wire.data.app_key,
      displayName: wire.data.display_name,
      description: wire.data.description,
      ...(replayed === undefined ? {} : { replayed }),
    });
  } catch {
    throw registryError(operation, {
      category: "invalid_response",
      upstreamStatus: 200,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
}

function mapRelease(value: unknown, operation: string): ControlPlaneAppRelease {
  const wire = WireAppReleaseSchema.safeParse(value);
  if (!wire.success) {
    throw registryError(operation, {
      category: "invalid_response",
      upstreamStatus: 200,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
  try {
    const replayed =
      wire.data.replayed === null ? undefined : wire.data.replayed;
    return ControlPlaneAppReleaseSchema.parse({
      id: wire.data.id,
      appId: wire.data.app_id,
      version: wire.data.version,
      manifest: wire.data.manifest,
      manifestChecksum: wire.data.manifest_checksum,
      registeredAt: wire.data.registered_at,
      ...(replayed === undefined ? {} : { replayed }),
    });
  } catch {
    throw registryError(operation, {
      category: "invalid_response",
      upstreamStatus: 200,
      httpStatus: 502,
      retryable: true,
      upstreamCode: "invalid_response",
    });
  }
}

export function createAkbAppRegistry(
  config: AkbAppRegistryConfig,
): AkbAppRegistry {
  const baseUrl = normalizeControlPlaneBaseUrl(config.baseUrl);
  validateControlPlaneTokenSource(config.adminToken);
  const policy = validateControlPlaneRequestPolicy(config.requestPolicy);
  const requestFetch = config.fetch ?? fetch;

  return Object.freeze({
    createApp: () =>
      withControlPlaneSpan(CREATE_APP_OPERATION, async (span) => {
        const response = await requestControlPlaneJson({
          baseUrl,
          tokenSource: config.adminToken,
          requestFetch,
          policy,
          operation: CREATE_APP_OPERATION,
          path: "/apps",
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              app_key: REEF_APP_DEFINITION.app_key,
              display_name: REEF_APP_DEFINITION.display_name,
              description: REEF_APP_DEFINITION.description,
            }),
          },
          acceptedStatuses: [200],
        });
        span.setAttribute("control_plane.http_status", response.status);
        const app = mapApp(response.body, CREATE_APP_OPERATION);
        if (app.appKey !== REEF_APP_DEFINITION.app_key) {
          throw registryError(CREATE_APP_OPERATION, {
            category: "invalid_response",
            upstreamStatus: response.status,
            httpStatus: 502,
            retryable: true,
            upstreamCode: "invalid_response",
          });
        }
        return app;
      }),

    getApp: (appId: string) => {
      const parsedAppId = parseId(appId, "appId");
      return withControlPlaneSpan(GET_APP_OPERATION, async (span) => {
        const response = await requestControlPlaneJson({
          baseUrl,
          tokenSource: config.adminToken,
          requestFetch,
          policy,
          operation: GET_APP_OPERATION,
          path: `/apps/${encodeURIComponent(parsedAppId)}`,
          init: { method: "GET" },
          acceptedStatuses: [200],
        });
        span.setAttribute("control_plane.http_status", response.status);
        return mapApp(response.body, GET_APP_OPERATION);
      });
    },

    createRelease: (input: FinalizedReleasePayload & { appId: string }) => {
      const parsedAppId = parseId(input.appId, "appId");
      return withControlPlaneSpan(CREATE_RELEASE_OPERATION, async (span) => {
        const finalized = await verifyFinalizedRelease({
          version: input.version,
          manifest: input.manifest,
          manifest_checksum: input.manifest_checksum,
        });
        const response = await requestControlPlaneJson({
          baseUrl,
          tokenSource: config.adminToken,
          requestFetch,
          policy,
          operation: CREATE_RELEASE_OPERATION,
          path: `/apps/${encodeURIComponent(parsedAppId)}/releases`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              version: finalized.version,
              manifest: finalized.manifest,
              manifest_checksum: finalized.manifest_checksum,
            }),
          },
          acceptedStatuses: [200],
        });
        span.setAttribute("control_plane.http_status", response.status);
        const release = mapRelease(response.body, CREATE_RELEASE_OPERATION);
        if (
          release.appId !== parsedAppId ||
          release.version !== finalized.version ||
          release.manifestChecksum !== finalized.manifest_checksum
        ) {
          throw registryError(CREATE_RELEASE_OPERATION, {
            category: "invalid_response",
            upstreamStatus: response.status,
            httpStatus: 502,
            retryable: true,
            upstreamCode: "invalid_response",
          });
        }
        if (
          canonicalJson(release.manifest) !== canonicalJson(finalized.manifest)
        ) {
          throw registryError(CREATE_RELEASE_OPERATION, {
            category: "invalid_response",
            upstreamStatus: response.status,
            httpStatus: 502,
            retryable: true,
            upstreamCode: "invalid_response",
          });
        }
        return release;
      });
    },

    getRelease: (appId: string, releaseId: string) => {
      const parsedAppId = parseId(appId, "appId");
      const parsedReleaseId = parseId(releaseId, "releaseId");
      return withControlPlaneSpan(GET_RELEASE_OPERATION, async (span) => {
        const response = await requestControlPlaneJson({
          baseUrl,
          tokenSource: config.adminToken,
          requestFetch,
          policy,
          operation: GET_RELEASE_OPERATION,
          path: `/apps/${encodeURIComponent(parsedAppId)}/releases/${encodeURIComponent(parsedReleaseId)}`,
          init: { method: "GET" },
          acceptedStatuses: [200],
        });
        span.setAttribute("control_plane.http_status", response.status);
        return mapRelease(response.body, GET_RELEASE_OPERATION);
      });
    },
  });
}
