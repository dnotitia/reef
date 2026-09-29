import type { ReportRequest } from "@reef/core";

export const reportsQueryKey = (vault: string) => ["reports", vault] as const;

export const reportsDataQueryKey = (vault: string, request: ReportRequest) =>
  [...reportsQueryKey(vault), request] as const;
