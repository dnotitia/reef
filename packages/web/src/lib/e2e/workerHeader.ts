/** Header used only by the hermetic E2E harness to select worker-local state. */
export const E2E_WORKER_HEADER = "x-reef-e2e-worker";

const SAFE_WORKER_ID = /^[A-Za-z0-9_-]{1,80}$/u;

/**
 * Forward a validated worker identity to local test doubles.
 *
 * The header is intentionally ignored when absent or malformed, so ordinary
 * production requests never acquire a synthetic fixture namespace.
 */
export function e2eWorkerHeaders(
  headers: Pick<Headers, "get">,
): Record<string, string> | undefined {
  if (!process.env.REEF_E2E_MOCK_URL) return undefined;
  const workerId = headers.get(E2E_WORKER_HEADER)?.trim();
  return workerId && SAFE_WORKER_ID.test(workerId)
    ? { [E2E_WORKER_HEADER]: workerId }
    : undefined;
}
