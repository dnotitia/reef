import {
  VaultNameSchema,
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  IssueCreateInputSchema,
  akbAllocateNextIssueId as allocateNextIssueId,
  buildIssueMetadataFromCreateInput,
  akbWriteIssue as writeIssue,
} from "@reef/core";
import { z } from "zod";

/**
 * POST /api/drafts/approve — commit an AI-drafted issue to the active vault.
 *
 * Body: `{ vault, prefix, create: { fields, content } }`
 * Response: `{ issueId }`
 *
 * Shares the allocate-then-write path with `POST /api/issues`; the
 * dedicated endpoint exists so dev-mode Server-Action logging doesn't leak
 * the JWT. Translates akb errors via `respondWithError`.
 */

const ApproveDraftRequestSchema = z.object({
  vault: VaultNameSchema,
  prefix: z.string().min(1),
  create: IssueCreateInputSchema,
});

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = ApproveDraftRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, prefix, create } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const id = await allocateNextIssueId({ adapter, vault, prefix });
    const issue = buildIssueMetadataFromCreateInput({
      id,
      create,
      author: actor,
      source: "ai-agent:create_issue",
    });
    await writeIssue({ adapter, vault, issue, content: create.content });
    return Response.json({ issueId: id }, { status: 201 });
  } catch (err) {
    // No-internals: does not echo raw err.message — respondWithError maps known
    // akb errors to localized PM copy and unknowns to a generic 500.
    logger.error({ err, vault }, "approve_draft failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
