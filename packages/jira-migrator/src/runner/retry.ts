import { JiraApiError } from "../jira/client.js";

export interface RetryOperationOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  operationKind?: "read" | "mutation";
  mutationPreconditionMaintained?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const defaultRetryable = (error: unknown): boolean =>
  error instanceof JiraApiError
    ? error.retryable
    : error instanceof Error &&
      "retryable" in error &&
      (error as Error & { retryable?: unknown }).retryable === true;

const retryAfterMs = (error: unknown): number =>
  error instanceof JiraApiError && error.rateLimit.retryAfterSeconds !== null
    ? error.rateLimit.retryAfterSeconds * 1_000
    : 0;

export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: RetryOperationOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const isRetryable = options.isRetryable ?? defaultRetryable;
  const retryMutation =
    options.operationKind !== "mutation" ||
    options.mutationPreconditionMaintained === true;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !retryMutation ||
        attempt >= options.maxRetries ||
        !isRetryable(error)
      ) {
        throw error;
      }
      const exponential = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** attempt,
      );
      const jittered = Math.round(exponential * (0.5 + random()));
      await sleep(Math.max(retryAfterMs(error), jittered));
    }
  }
}
