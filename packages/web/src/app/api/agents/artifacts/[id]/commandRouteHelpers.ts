import {
  AgentArtifactCommandError,
  type AgentArtifactReviewContext,
} from "@/lib/api/agentArtifactReview";
import {
  agentErrorEnvelope,
  localizedAgentError,
} from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { ReefError } from "@reef/core";
import { z } from "zod";

const AgentArtifactIdSchema = z.string().min(1).max(200);

export function validateAgentArtifactId(id: string): Promise<Response> | null {
  const idResult = AgentArtifactIdSchema.safeParse(id);
  if (idResult.success) return null;
  return localizedAgentError(
    "agent.invalidArtifactId",
    400,
    "invalid_artifact_id",
  );
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
}): Promise<Response> {
  return localizedAgentError(
    "agent.artifactIdMismatch",
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
  if ("response" in adapterResult) {
    // `getAkbAdapter` defers its localized 401 as a Promise; this helper is
    // async, so settle it to a `Response` for the shared `{ response }` shape.
    return { response: await adapterResult.response };
  }
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

/**
 * Map a stable snake_case agent error code to its `errors.agent.*` catalog key
 * (REEF-308). `AgentArtifactCommandError` carries the code as its contract; the
 * web boundary resolves the PM-facing message by code, so the catalog leaf is
 * the camelCase form of the code under the `agent` namespace.
 */
function agentErrorKeyFromCode(code: string): string {
  const camel = code.replace(/_([a-z0-9])/g, (_match, char: string) =>
    char.toUpperCase(),
  );
  return `agent.${camel}`;
}

export function agentArtifactCommandErrorResponse(
  err: unknown,
): Promise<Response> | null {
  if (!(err instanceof AgentArtifactCommandError)) return null;
  // Resolve the localized message from the stable `code` (AC3), falling back to
  // the error's carried English message for any code not yet in the catalog.
  return localizedAgentError(
    agentErrorKeyFromCode(err.code),
    err.status,
    err.code,
    err.details,
    err.message,
  );
}

export async function reefAgentErrorResponse(
  err: unknown,
  code: string,
  details?: Record<string, unknown>,
): Promise<Response | null> {
  if (!(err instanceof ReefError)) return null;
  // `respondWithError` already localizes the `ReefError`; lift its message into
  // the agent envelope under the caller's runtime code.
  const res = await respondWithError(err, { resourceKind: "workspace" });
  const body = (await res.json()) as { error: string };
  return agentErrorEnvelope(body.error, res.status, code, details);
}
