import { AuthError, GitHubApiError, NotFoundError } from "../../errors";

export function normalizeAuthenticatedReposError(err: unknown): Error {
  const status = getErrorStatus(err);
  if (status === 401) {
    return new AuthError({});
  }
  if (status === 404) {
    return new NotFoundError({ resource: "repository" });
  }
  return new GitHubApiError({
    status: status ?? 500,
    message: err instanceof Error ? err.message : "Unknown error",
  });
}

export function normalizeRepositoryReadError(
  err: unknown,
  notFoundResource: string,
): Error {
  const status = getErrorStatus(err);
  if (status === 404) {
    return new NotFoundError({ resource: notFoundResource });
  }
  if (status === 401 || status === 403) {
    return new AuthError({});
  }
  return new GitHubApiError({
    status: status ?? 500,
    message: err instanceof Error ? err.message : "Unknown error",
  });
}

export function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function getResponseHeader(err: unknown, name: string): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  if (!("headers" in response)) return null;
  return readHeader((response as { headers?: unknown }).headers, name);
}

export function readHeader(headers: unknown, name: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;
  const values = headers as Record<string, unknown>;
  const direct = values[name];
  if (typeof direct === "string") return direct;
  const lower = values[name.toLowerCase()];
  return typeof lower === "string" ? lower : null;
}
