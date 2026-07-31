import { AkbApiError } from "@reef/core";

export const isRetryableAkbReadError = (error: unknown): boolean =>
  error instanceof AkbApiError &&
  (error.status === 0 || error.status === 429 || error.status >= 500);

export async function retryAkbRead<T>(
  read: () => Promise<T>,
  options: {
    wait: () => Promise<void>;
    maxAttempts?: number;
  },
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 20;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!isRetryableAkbReadError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      await options.wait();
    }
  }
}
