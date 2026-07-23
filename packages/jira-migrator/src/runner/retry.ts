import { JiraApiError } from "../jira/client.js";

export interface RetryOperationOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  operationKind?: "read" | "mutation";
  mutationPreconditionMaintained?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  abortError?: () => Error;
  random?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

const abortError = (options: RetryOperationOptions): Error =>
  options.abortError?.() ?? new Error("retry_aborted");

const sleepWithSignal = async (
  milliseconds: number,
  options: RetryOperationOptions,
): Promise<void> => {
  if (options.signal?.aborted) throw abortError(options);
  if (options.sleep) {
    if (!options.signal) {
      await options.sleep(milliseconds);
      return;
    }
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError(options));
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([options.sleep(milliseconds), aborted]);
    } finally {
      if (onAbort) options.signal.removeEventListener("abort", onAbort);
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => finish(abortError(options));
    function finish(error?: Error) {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
};

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
  const random = options.random ?? Math.random;
  const isRetryable = options.isRetryable ?? defaultRetryable;
  const retryMutation =
    options.operationKind !== "mutation" ||
    options.mutationPreconditionMaintained === true;

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options);
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
      await sleepWithSignal(Math.max(retryAfterMs(error), jittered), options);
    }
  }
}
