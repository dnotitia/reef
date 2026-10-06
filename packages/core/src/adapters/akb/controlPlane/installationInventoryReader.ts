import { z } from "zod";
import {
  ControlPlaneInstallationInventoryItemSchema,
  ControlPlaneIdSchema,
  type ControlPlaneInstallationInventoryItem,
} from "../../../schemas/controlPlane";
import { VaultNameSchema } from "../../../schemas/workspace/config";
import {
  controlPlaneError,
  normalizeControlPlaneBaseUrl,
  resolveControlPlaneToken,
  requestControlPlaneJson,
  validateControlPlaneRequestPolicy,
  validateControlPlaneTokenSource,
  withControlPlaneSpan,
  type ControlPlaneRequestPolicy,
  type ControlPlaneTokenSource,
} from "./http";

const OPERATION = "app.installations.inventory.list_active";
const PAGE_SIZE = 200;

const WireInventoryItemSchema = z.looseObject({
  installation_id: ControlPlaneIdSchema,
  app_id: ControlPlaneIdSchema,
  vault_id: ControlPlaneIdSchema,
  vault_name: VaultNameSchema,
  lifecycle: z.literal("active"),
});

const WireInventoryPageSchema = z.looseObject({
  items: z.array(WireInventoryItemSchema),
  next_cursor: z.string().min(1).nullable(),
});

const WireAppTokenSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  expires_at: z.string().min(1),
});

export interface AkbAppInstallationInventoryReaderConfig {
  baseUrl: string;
  appCredential: ControlPlaneTokenSource;
  fetch?: typeof fetch;
  requestPolicy?: ControlPlaneRequestPolicy;
}

export interface AkbAppInstallationInventoryReader {
  readonly listActiveInstallations: () => Promise<
    ControlPlaneInstallationInventoryItem[]
  >;
}

function invalidInventoryResponse(upstreamStatus: number) {
  return controlPlaneError(OPERATION, {
    category: "invalid_response",
    upstreamStatus,
    httpStatus: 502,
    retryable: true,
    upstreamCode: "invalid_response",
  });
}

async function exchangeAppCredential(
  baseUrl: string,
  appCredential: ControlPlaneTokenSource,
  requestFetch: typeof fetch,
  policy: ControlPlaneRequestPolicy,
): Promise<string> {
  return withControlPlaneSpan(
    "auth.app_token.exchange",
    async (_span, setUpstreamStatus) => {
      let credential: string;
      try {
        credential = resolveControlPlaneToken(appCredential);
      } catch {
        throw controlPlaneError("auth.app_token.exchange", {
          category: "authentication",
          upstreamStatus: 0,
          httpStatus: 401,
          retryable: false,
          upstreamCode: "missing_app_credential",
        });
      }
      const response = await requestControlPlaneJson({
        baseUrl,
        tokenSource: credential,
        requestFetch,
        policy,
        operation: "auth.app_token.exchange",
        path: "/auth/app-token",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        },
        acceptedStatuses: [200],
        missingTokenCode: "missing_app_credential",
        authorizationHeader: false,
      });
      setUpstreamStatus(response.status);
      const parsed = WireAppTokenSchema.safeParse(response.body);
      if (!parsed.success) throw invalidInventoryResponse(response.status);
      return parsed.data.access_token;
    },
    "app",
  );
}

/**
 * Read the complete app-scoped active installation inventory. A partial or
 * internally inconsistent snapshot is rejected so callers never reconcile a
 * truncated set of vaults.
 */
export function createAkbAppInstallationInventoryReader(
  config: AkbAppInstallationInventoryReaderConfig,
): AkbAppInstallationInventoryReader {
  const baseUrl = normalizeControlPlaneBaseUrl(config.baseUrl);
  validateControlPlaneTokenSource(config.appCredential);
  const policy = validateControlPlaneRequestPolicy(config.requestPolicy);
  const requestFetch = config.fetch ?? fetch;

  return Object.freeze({
    async listActiveInstallations(): Promise<
      ControlPlaneInstallationInventoryItem[]
    > {
      return withControlPlaneSpan(
        OPERATION,
        async (span, setUpstreamStatus) => {
          const appToken = await exchangeAppCredential(
            baseUrl,
            config.appCredential,
            requestFetch,
            policy,
          );
          const installations: ControlPlaneInstallationInventoryItem[] = [];
          const installationIds = new Set<string>();
          const vaultIds = new Set<string>();
          const cursors = new Set<string>();
          let cursor: string | null = null;
          let appId: string | undefined;
          let pagesRead = 0;

          for (;;) {
            const query = new URLSearchParams({
              limit: String(PAGE_SIZE),
              lifecycle: "active",
            });
            if (cursor !== null) query.set("cursor", cursor);

            const response = await requestControlPlaneJson({
              baseUrl,
              tokenSource: appToken,
              requestFetch,
              policy,
              operation: OPERATION,
              path: `/app/inventory?${query.toString()}`,
              init: { method: "GET" },
              acceptedStatuses: [200],
              missingTokenCode: "missing_app_token",
            });
            setUpstreamStatus(response.status);
            pagesRead += 1;

            const parsed = WireInventoryPageSchema.safeParse(response.body);
            if (!parsed.success)
              throw invalidInventoryResponse(response.status);

            for (const wireItem of parsed.data.items) {
              if (appId !== undefined && wireItem.app_id !== appId) {
                throw invalidInventoryResponse(response.status);
              }
              appId ??= wireItem.app_id;
              if (
                installationIds.has(wireItem.installation_id) ||
                vaultIds.has(wireItem.vault_id)
              ) {
                throw invalidInventoryResponse(response.status);
              }
              installationIds.add(wireItem.installation_id);
              vaultIds.add(wireItem.vault_id);

              installations.push(
                ControlPlaneInstallationInventoryItemSchema.parse({
                  installationId: wireItem.installation_id,
                  appId: wireItem.app_id,
                  vaultId: wireItem.vault_id,
                  vaultName: wireItem.vault_name,
                  lifecycle: wireItem.lifecycle,
                }),
              );
            }

            cursor = parsed.data.next_cursor;
            if (cursor === null) break;
            if (cursors.has(cursor)) {
              throw invalidInventoryResponse(response.status);
            }
            cursors.add(cursor);
          }

          span.setAttribute("control_plane.page_count", pagesRead);
          span.setAttribute(
            "control_plane.installation_count",
            installations.length,
          );
          return installations;
        },
        "app",
      );
    },
  });
}
