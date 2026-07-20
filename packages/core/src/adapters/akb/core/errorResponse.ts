export interface AkbErrorResponse {
  message: string;
  code?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Read the supported FastAPI and AKB error envelopes without losing `code`. */
export async function readAkbErrorResponse(
  response: Response,
): Promise<AkbErrorResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: response.statusText || "Unknown error" };
  }

  const root = asRecord(body);
  const detail = root?.detail;
  const detailRecord = asRecord(detail);
  const firstDetail = Array.isArray(detail) ? asRecord(detail[0]) : null;

  const code = nonEmptyString(root?.code) ?? nonEmptyString(detailRecord?.code);
  const message =
    nonEmptyString(detailRecord?.message) ??
    nonEmptyString(detail) ??
    nonEmptyString(firstDetail?.msg) ??
    nonEmptyString(root?.message) ??
    nonEmptyString(root?.error) ??
    (response.statusText || "Unknown error");

  return code ? { message, code } : { message };
}
