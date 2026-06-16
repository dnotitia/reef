import {
  getAkbAdapter,
  invalidIssueIdResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
} from "@/lib/api/requestHelpers";
import type { AkbAdapter } from "@reef/core";

export function getIssueRouteReadContext(
  request: Request,
  id: string,
): { id: string; vault: string; adapter: AkbAdapter } | { response: Response } {
  if (!isValidIssueIdPathParam(id)) {
    return { response: invalidIssueIdResponse() };
  }

  const vault = parseVaultParam(request);
  if (!vault) return { response: missingVaultParamResponse() };

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult;
  return { id, vault, adapter: adapterResult.adapter };
}
