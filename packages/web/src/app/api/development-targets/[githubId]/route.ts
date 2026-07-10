import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  requireVaultAdmin,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { getDevelopmentProfileCatalog } from "@/lib/server/developmentProfiles";
import {
  DevelopmentBranchTemplateSchema,
  DevelopmentProfileIdSchema,
  DevelopmentRecipePathSchema,
  DevelopmentTargetConfigSchema,
  VaultNameSchema,
  akbWriteDevelopmentTarget as writeDevelopmentTarget,
} from "@reef/core";
import { z } from "zod";

const RequestSchema = z
  .object({
    vault: VaultNameSchema,
    target: z
      .object({
        enabled: z.boolean(),
        recipe_path: DevelopmentRecipePathSchema.nullable().default(null),
        runner_profile: DevelopmentProfileIdSchema.nullable().default(null),
        permission_profile: DevelopmentProfileIdSchema.nullable().default(null),
        branch_template:
          DevelopmentBranchTemplateSchema.nullable().default(null),
      })
      .strict(),
  })
  .strict();

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ githubId: string }> },
): Promise<Response> {
  const { githubId: rawGithubId } = await params;
  const githubId = Number(rawGithubId);
  if (!Number.isSafeInteger(githubId) || githubId <= 0) {
    return localizedErrorResponse("invalidGithubId", 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const parsedTarget = DevelopmentTargetConfigSchema.safeParse({
    github_id: githubId,
    ...parsed.data.target,
  });
  if (!parsedTarget.success) return invalidBodyResponse(parsedTarget.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const { vault } = parsed.data;
  const adminResult = await requireVaultAdmin(adapter, vault);
  if ("response" in adminResult) return adminResult.response;

  try {
    const saved = await writeDevelopmentTarget({
      adapter,
      vault,
      target: parsedTarget.data,
      catalog: await getDevelopmentProfileCatalog(),
    });
    return Response.json({ target: saved });
  } catch (err) {
    logger.error(
      { err, vault, github_id: githubId },
      "write_development_target failed",
    );
    return respondWithError(err, { resourceKind: "config" });
  }
}
