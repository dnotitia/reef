import {
  getWorkspaceAkbAdapter,
  invalidIssueIdResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
} from "@/lib/api/requestHelpers";
import type { AkbAdapter } from "@reef/core";

export async function getIssueRouteReadContext(
  request: Request,
  id: string,
): Promise<
  { id: string; vault: string; adapter: AkbAdapter } | { response: Response }
> {
  if (!isValidIssueIdPathParam(id)) {
    return { response: await invalidIssueIdResponse() };
  }

  const vault = parseVaultParam(request);
  if (!vault) return { response: await missingVaultParamResponse() };

  const adapterResult = await getWorkspaceAkbAdapter(request, vault);
  if ("response" in adapterResult) return adapterResult;
  return { id, vault, adapter: adapterResult.adapter };
}
