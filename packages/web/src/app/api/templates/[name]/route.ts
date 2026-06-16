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
  TEMPLATE_NAME_PATTERN,
  TemplateSchema,
  akbDeleteTemplate as deleteTemplate,
  akbReadTemplate as readTemplate,
  akbWriteTemplate as writeTemplate,
} from "@reef/core";
import { z } from "zod";

/**
 *   GET    /api/templates/{name}?vault={vault_name}      → { template }
 *   PUT    /api/templates/{name}   { vault, template }   → { template }
 *   DELETE /api/templates/{name}?vault={vault_name}      → 204
 */

const PutBodySchema = z.object({
  vault: VaultNameSchema,
  template: TemplateSchema,
});

function invalidNameResponse(): Response {
  return Response.json(
    {
      error:
        "Invalid template name. Expected lowercase letters, digits, hyphens only.",
    },
    { status: 400 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  if (!TEMPLATE_NAME_PATTERN.test(name)) return invalidNameResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { template } = await readTemplate({ adapter, vault, name });
    return Response.json({ template });
  } catch (err) {
    logger.error({ err, vault, name }, "read_template failed");
    return respondWithError(err, { resourceKind: "template" });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  if (!TEMPLATE_NAME_PATTERN.test(name)) return invalidNameResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, template } = parsed.data;

  // Filename and embedded id should stay aligned — rename is delete-then-create.
  if (template.name !== name) {
    return Response.json(
      {
        error:
          "Template name in body must match URL segment. Delete and create to rename.",
      },
      { status: 400 },
    );
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await writeTemplate({ adapter, vault, template });
    return Response.json({ template });
  } catch (err) {
    logger.error({ err, vault, name }, "write_template failed");
    return respondWithError(err, { resourceKind: "template" });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  if (!TEMPLATE_NAME_PATTERN.test(name)) return invalidNameResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await deleteTemplate({ adapter, vault, name });
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err, vault, name }, "delete_template failed");
    return respondWithError(err, { resourceKind: "template" });
  }
}
