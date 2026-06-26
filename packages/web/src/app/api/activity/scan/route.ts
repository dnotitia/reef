import {
  localizeError,
  localizedErrorResponse,
} from "@/lib/api/errorLocalization";
import {
  VaultNameSchema,
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
} from "@/lib/api/requestHelpers";
import { resolveScanGitHubAdapter } from "@/lib/github/resolveScanGitHubAdapter";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "@/lib/llm/serverConfig";
import { logger } from "@/lib/logging/logger";
import {
  createLlmAdapter,
  scanAndPersistActivitySuggestions,
} from "@reef/core";
import { z } from "zod";

/**
 * POST /api/activity/scan — unified read scan of monitored-repo activity.
 *
 * Replaces `/api/activity/detect`, which produced `PendingDraft[]` for
 * untracked commits/PRs. Scan additionally detects tracked activity that
 * references an existing reef issue ID, suppresses already-known AKB
 * suggestions, and writes new suggestions into `_reef/activity-inbox`.
 *
 * Thin wrapper:
 *  1. Parse body
 *  2. Resolve the GitHub adapter via the shared scan resolver (server-managed
 *     GitHub App required — REEF-244), read the akb session from the cookie,
 *     and the LLM config from env
 *  3. Call core scan-and-persist workflow
 *  4. Return added suggestion counts
 *  5. Return `{ addedDrafts, addedStatusChanges, scannedAt }`
 *
 * Stateless: adapters per-request; nothing cached server-side.
 */

const ScanActivityRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  vault: VaultNameSchema,
  // Optional: omitted on the first scan when no last_scan_at is stored.
  since: z.string().min(1).optional(),
  projectPrefix: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = ScanActivityRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return invalidBodyResponse(parsed.error);
  }
  const { owner, repo, vault, since, projectPrefix } = parsed.data;

  const akb = getAkbAdapter(request);
  if ("response" in akb) {
    return akb.response;
  }

  // REEF-313: the workspace AI-scanning kill switch is enforced inside the core
  // `scanAndPersistActivitySuggestions` funnel — the single point every caller
  // (this manual route, the agent run, and any future worker) shares — so a
  // disabled workspace never reads repo activity, calls the LLM, or writes a
  // suggestion regardless of entry point. This thin route deliberately does not
  // re-read config to short-circuit before adapter resolution; reef's own UI
  // already hides the manual scan affordance when scanning is off, so the only
  // way here is a direct/stale client, which the core gate turns into a clean
  // no-op.
  const github = await resolveScanGitHubAdapter(request);
  if (github.kind === "session_invalid") {
    return github.response;
  }
  if (github.kind === "github_app_unconfigured") {
    return localizedErrorResponse("githubAppUnconfigured", 503);
  }
  if (github.kind === "github_error") {
    logger.error({ err: github.error, owner, repo }, "scan_activity failed");
    return localizeError(github.error);
  }

  let llmConfig: ReturnType<typeof getRequiredServerLlmConfig>;
  try {
    llmConfig = getRequiredServerLlmConfig();
  } catch (err) {
    if (err instanceof ServerLlmConfigError) {
      return Response.json(
        {
          error:
            "AI service is unavailable for this deployment. You can still browse activity manually.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error:
          "AI service is unavailable for this deployment. You can still browse activity manually.",
      },
      { status: 503 },
    );
  }

  const llmAdapter = createLlmAdapter({
    apiKey: llmConfig.api_key,
    baseUrl: llmConfig.base_url,
    model: llmConfig.model,
  });

  try {
    const result = await scanAndPersistActivitySuggestions({
      adapter: github.adapter,
      akbAdapter: akb.adapter,
      vault,
      llmAdapter,
      owner,
      repo,
      ...(since ? { since } : {}),
      projectPrefix,
    });

    return Response.json(
      {
        addedDrafts: result.addedDrafts,
        addedStatusChanges: result.addedStatusChanges,
        scannedAt: result.scannedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    logger.error({ err, owner, repo }, "scan_activity failed");
    // Discriminate typed ReefError subclasses (GitHubApiError/AuthError/
    // NotFoundError → 401/404, AkbApiError → 502, …) instead of collapsing
    // everything to 500 and leaking raw err.message. (REEF-051)
    return localizeError(err);
  }
}
