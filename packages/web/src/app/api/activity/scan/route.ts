import { VaultNameSchema, getAkbAdapter } from "@/lib/api/requestHelpers";
import { resolveScanGitHubAdapter } from "@/lib/github/resolveScanGitHubAdapter";
import {
  ServerLlmConfigError,
  getRequiredServerLlmConfig,
} from "@/lib/llm/serverConfig";
import { logger } from "@/lib/logging/logger";
import {
  createLlmAdapter,
  scanAndPersistActivitySuggestions,
  translateError,
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
 *     GitHub App when configured, browser PAT fallback otherwise — REEF-240),
 *     read the akb session from the cookie, and the LLM config from env
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
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ScanActivityRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { owner, repo, vault, since, projectPrefix } = parsed.data;

  const akb = getAkbAdapter(request);
  if ("response" in akb) {
    return akb.response;
  }

  const github = await resolveScanGitHubAdapter(request);
  if (github.kind === "session_invalid") {
    return github.response;
  }
  if (github.kind === "github_auth_required") {
    return Response.json(
      {
        error: "Authentication required. Reconnect GitHub in Settings.",
      },
      { status: 401 },
    );
  }
  if (github.kind === "github_error") {
    logger.error({ err: github.error, owner, repo }, "scan_activity failed");
    return translateError(github.error);
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
    return translateError(err);
  }
}
