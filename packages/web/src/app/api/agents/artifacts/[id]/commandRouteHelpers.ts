import {
  AgentArtifactCommandError,
  type AgentArtifactReviewContext,
} from "@/lib/api/agentArtifactReview";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { AgentErrorSchema, ReefError } from "@reef/core";
import { z } from "zod";

const AgentArtifactIdSchema = z.string().min(1).max(200);

export function validateAgentArtifactId(id: string): Response | null {
  const idResult = AgentArtifactIdSchema.safeParse(id);
  if (idResult.success) return null;
  return jsonAgentError("Invalid artifact id.", 400, "invalid_artifact_id");
}

export async function readJsonBody(request: Request): Promise<unknown> {
  return request.json();
}

export async function readJsonOrEmpty(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function artifactIdMismatchResponse({
  pathArtifactId,
  bodyArtifactId,
}: {
  pathArtifactId: string;
  bodyArtifactId: string;
}): Response {
  return jsonAgentError(
    "Artifact id does not match the request path.",
    400,
    "artifact_id_mismatch",
    {
      path_artifact_id: pathArtifactId,
      body_artifact_id: bodyArtifactId,
    },
  );
}

export async function getAgentArtifactReviewContext(
  request: Request,
  vault: string,
): Promise<{ context: AgentArtifactReviewContext } | { response: Response }> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult;
  return {
    context: {
      adapter: adapterResult.adapter,
      vault,
      actor: actorResult.actor,
    },
  };
}

export function agentArtifactCommandErrorResponse(
  err: unknown,
): Response | null {
  if (!(err instanceof AgentArtifactCommandError)) return null;
  return jsonAgentError(err.message, err.status, err.code, err.details);
}

export async function reefAgentErrorResponse(
  err: unknown,
  code: string,
  details?: Record<string, unknown>,
): Promise<Response | null> {
  if (!(err instanceof ReefError)) return null;
  const res = respondWithError(err, { resourceKind: "workspace" });
  const body = (await res.json()) as { error: string };
  return jsonAgentError(body.error, res.status, code, details);
}

export function jsonAgentError(
  message: string,
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      error: message,
      runtime_error: AgentErrorSchema.parse({
        code,
        message,
        recoverable: status >= 500,
        details,
      }),
    },
    { status },
  );
}
