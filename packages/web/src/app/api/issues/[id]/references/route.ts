import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidIssueIdResponse,
  invalidJsonBodyResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  AddIssueReferenceRequestSchema,
  akbAddIssueReference as addIssueReference,
  akbListIssueReferences as listIssueReferences,
  akbRemoveIssueReference as removeIssueReference,
} from "@reef/core";

/**
 * The akb-native `references` relation edges from an issue's document to akb
 * documents (REEF-083). `vault` is a query param; the edge write surface is
 * REEF-088's `POST`/`DELETE /api/v1/relations` (writer). Mutations return the
 * refreshed list so the client can replace its cache in one round-trip.
 */

/** GET /api/issues/[id]/references?vault={vault} → { references } */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const references = await runRouteSpan({
      name: "route.list_issue_references",
      attributes: { vault, issue_id: id },
      run: () => listIssueReferences(adapter, vault, id),
    });
    return Response.json({ references });
  } catch (err) {
    logger.error({ err, vault, id }, "list_issue_references failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/** POST /api/issues/[id]/references?vault={vault} — body { target_uri } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = AddIssueReferenceRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  // Cross-vault guard: the target document should live in the request's vault, so
  // a caller does not forge an edge into another workspace.
  if (/^akb:\/\/([^/]+)\//.exec(parsed.data.target_uri)?.[1] !== vault) {
    return Response.json(
      { error: "The document must be in the same workspace as the issue." },
      { status: 400 },
    );
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const references = await runRouteSpan({
      name: "route.add_issue_reference",
      attributes: { vault, issue_id: id },
      run: async () => {
        await addIssueReference(adapter, vault, id, parsed.data.target_uri);
        return listIssueReferences(adapter, vault, id);
      },
    });
    return Response.json({ references });
  } catch (err) {
    logger.error({ err, vault, id }, "add_issue_reference failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/** DELETE /api/issues/[id]/references?vault={vault}&target_uri={uri} */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  // Reuse the add-request schema to validate the target URI carried as a query
  // param (unlink takes its endpoints as query, does not a body).
  const parsed = AddIssueReferenceRequestSchema.safeParse({
    target_uri: searchParams.get("target_uri") ?? "",
  });
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const references = await runRouteSpan({
      name: "route.remove_issue_reference",
      attributes: { vault, issue_id: id },
      run: async () => {
        await removeIssueReference(adapter, vault, id, parsed.data.target_uri);
        return listIssueReferences(adapter, vault, id);
      },
    });
    return Response.json({ references });
  } catch (err) {
    logger.error({ err, vault, id }, "remove_issue_reference failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
