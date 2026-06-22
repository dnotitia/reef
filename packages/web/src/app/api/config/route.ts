import {
  VaultNameSchema,
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  AuthoringLanguageSchema,
  type Config,
  ConfigSchema,
  MonitoredRepoSchema,
  PROJECT_PREFIX_PATTERN,
  StaleHideDaysSchema,
  akbReadConfig as readConfig,
  akbWriteConfig as writeConfig,
} from "@reef/core";
import { z } from "zod";

/**
 * /api/config — Read/write the team-shared reef workspace config in the
 * active akb vault's `_reef/config` document. Per-user state (LLM api_key,
 * theme, active vault pointer) stays in IndexedDB and does not touches this route.
 *
 *   GET   /api/config?vault={vault_name}  → { config }
 *   PATCH /api/config  { vault, patch }   → { config }
 *
 * Last-write-wins; the route reads, merges, and writes back. Concurrent
 * `monitored_repos` toggles are accepted on a first-write-wins basis.
 */

const ConfigPatchSchema = z
  .object({
    project_prefix: z
      .string()
      .regex(
        PROJECT_PREFIX_PATTERN,
        "project_prefix must be uppercase A–Z only",
      )
      .optional(),
    monitored_repos: z.array(MonitoredRepoSchema).optional(),
    // REEF-136: a language code sets the workspace authoring default; explicit
    // null clears it (the patch-merge keeps null, drops just `undefined`).
    authoring_language: AuthoringLanguageSchema.nullable().optional(),
    stale_hide_completed_days: StaleHideDaysSchema.optional(),
    stale_hide_canceled_days: StaleHideDaysSchema.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "patch must not be empty");

const PatchRequestSchema = z.object({
  vault: VaultNameSchema,
  patch: ConfigPatchSchema,
});

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { config } = await readConfig({ adapter, vault });
    return Response.json({ config });
  } catch (err) {
    logger.error({ err, vault }, "read_config failed");
    return respondWithError(err, { resourceKind: "config" });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = PatchRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, patch } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { config: current } = await readConfig({ adapter, vault });

    // Drop undefined entries so `.optional()` keys present-but-undefined
    // in the request body don't clobber the stored values.
    const patchClean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    const merged: Config = ConfigSchema.parse({ ...current, ...patchClean });

    await writeConfig({ adapter, vault, config: merged });
    return Response.json({ config: merged });
  } catch (err) {
    logger.error({ err, vault }, "write_config failed");
    return respondWithError(err, { resourceKind: "config" });
  }
}
