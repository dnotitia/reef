import { approveAgentArtifact } from "@/lib/api/agentArtifactReview";
import { localizedAgentError } from "@/lib/api/errorLocalization";
import { logger } from "@/lib/logging/logger";
import { AgentArtifactCommandRequestSchema } from "@reef/core";
import {
  agentArtifactCommandErrorResponse,
  artifactIdMismatchResponse,
  getAgentArtifactReviewContext,
  readJsonOrEmpty,
  reefAgentErrorResponse,
  validateAgentArtifactId,
} from "../commandRouteHelpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const idError = validateAgentArtifactId(id);
  if (idError) return idError;

  let rawBody: unknown;
  try {
    rawBody = await readJsonOrEmpty(request);
  } catch {
    return localizedAgentError("invalidJsonBody", 400, "invalid_json_body");
  }

  const parsed = AgentArtifactCommandRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return localizedAgentError(
      "agent.artifactApprovalRequestInvalid",
      400,
      "invalid_artifact_command_request",
      { validation: parsed.error.flatten() },
    );
  }

  const { artifact, prefix, vault } = parsed.data;
  if (!artifact) {
    return localizedAgentError(
      "agent.artifactApprovalMissingArtifact",
      400,
      "missing_artifact",
      { artifact_id: id },
    );
  }
  if (artifact.artifact_id !== id) {
    return artifactIdMismatchResponse({
      pathArtifactId: id,
      bodyArtifactId: artifact.artifact_id,
    });
  }
  if (!vault) {
    return localizedAgentError(
      "agent.artifactApprovalMissingVault",
      400,
      "missing_vault",
      { artifact_id: id },
    );
  }

  const contextResult = await getAgentArtifactReviewContext(request, vault);
  if ("response" in contextResult) return contextResult.response;
  const { context } = contextResult;

  try {
    const result = await approveAgentArtifact({
      ...context,
      artifact,
      prefix,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const commandError = agentArtifactCommandErrorResponse(err);
    if (commandError) return commandError;
    logger.error({ err, vault, id }, "approve_agent_artifact failed");
    const reefError = await reefAgentErrorResponse(
      err,
      "approve_agent_artifact_failed",
    );
    if (reefError) return reefError;
    return localizedAgentError(
      "agent.unexpectedError",
      500,
      "unexpected_error",
    );
  }
}
