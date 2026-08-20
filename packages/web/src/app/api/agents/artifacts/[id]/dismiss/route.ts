import { dismissAgentArtifact } from "@/lib/api/agentArtifactReview";
import { localizedAgentError } from "@/lib/api/errorLocalization";
import { logger } from "@/lib/logging/logger";
import { AgentArtifactCommandRequestSchema } from "@reef/core";
import { z } from "zod";
import {
  agentArtifactCommandErrorResponse,
  artifactIdMismatchResponse,
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
      "agent.artifactDismissalRequestInvalid",
      400,
      "invalid_artifact_command_request",
      { validation: z.flattenError(parsed.error) },
    );
  }

  if (!parsed.data.artifact) {
    return localizedAgentError(
      "agent.artifactDismissalMissingArtifact",
      400,
      "missing_artifact",
      { artifact_id: id },
    );
  }
  if (parsed.data.artifact.artifact_id !== id) {
    return artifactIdMismatchResponse({
      pathArtifactId: id,
      bodyArtifactId: parsed.data.artifact.artifact_id,
    });
  }
  try {
    const result = await dismissAgentArtifact({
      artifact: parsed.data.artifact,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const commandError = agentArtifactCommandErrorResponse(err);
    if (commandError) return commandError;
    logger.error(
      { err, artifact_id: id, vault: parsed.data.vault },
      "dismiss_agent_artifact failed",
    );
    const reefError = await reefAgentErrorResponse(
      err,
      "dismiss_agent_artifact_failed",
    );
    if (reefError) return reefError;
    return localizedAgentError(
      "agent.unexpectedError",
      500,
      "unexpected_error",
    );
  }
}
