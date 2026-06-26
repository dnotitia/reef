import {
  editAgentArtifact,
  isActivitySuggestionBackedArtifact,
} from "@/lib/api/agentArtifactReview";
import { localizedAgentError } from "@/lib/api/errorLocalization";
import { logger } from "@/lib/logging/logger";
import { AgentArtifactEditRequestSchema } from "@reef/core";
import {
  agentArtifactCommandErrorResponse,
  artifactIdMismatchResponse,
  getAgentArtifactReviewContext,
  readJsonBody,
  reefAgentErrorResponse,
  validateAgentArtifactId,
} from "./commandRouteHelpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const idError = validateAgentArtifactId(id);
  if (idError) return idError;

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request);
  } catch {
    return localizedAgentError("invalidJsonBody", 400, "invalid_json_body");
  }

  const parsed = AgentArtifactEditRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return localizedAgentError(
      "agent.artifactEditRequestInvalid",
      400,
      "invalid_artifact_edit_request",
      { validation: parsed.error.flatten() },
    );
  }
  if (parsed.data.artifact.artifact_id !== id) {
    return artifactIdMismatchResponse({
      pathArtifactId: id,
      bodyArtifactId: parsed.data.artifact.artifact_id,
    });
  }
  if (
    !parsed.data.vault &&
    isActivitySuggestionBackedArtifact(parsed.data.artifact)
  ) {
    return localizedAgentError(
      "agent.artifactEditMissingVault",
      400,
      "missing_vault",
      { artifact_id: id },
    );
  }

  let context = null;
  if (parsed.data.vault) {
    const contextResult = await getAgentArtifactReviewContext(
      request,
      parsed.data.vault,
    );
    if ("response" in contextResult) return contextResult.response;
    context = contextResult.context;
  }

  try {
    const result = await editAgentArtifact({
      artifact: parsed.data.artifact,
      patch: parsed.data.patch,
      context,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const commandError = agentArtifactCommandErrorResponse(err);
    if (commandError) return commandError;
    logger.error(
      { err, artifact_id: id, vault: parsed.data.vault },
      "edit_agent_artifact failed",
    );
    // akb-origin errors (context ops) get their canonical status via core,
    // wrapped back into the agent error envelope the artifact client reads.
    const reefError = await reefAgentErrorResponse(
      err,
      "edit_agent_artifact_failed",
      { artifact_id: id },
    );
    if (reefError) return reefError;
    // A bad patch fails AgentArtifactSchema.parse() with a ZodError → the typed
    // client-facing 400. No-internals: does not echo the raw error message.
    return localizedAgentError(
      "agent.artifactEditInvalid",
      400,
      "invalid_artifact_edit",
      { artifact_id: id },
    );
  }
}
