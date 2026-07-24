import { describe, expect, it, vi } from "vitest";
import { JiraApiError } from "../jira/client.js";
import { retryOperation } from "./retry.js";

const rateLimit = (retryAfterSeconds: number | null) => ({
  limit: null,
  remaining: null,
  reset: null,
  nearLimit: false,
  retryAfterSeconds,
});

describe("retryOperation", () => {
  it("honors Retry-After as a minimum with deterministic exponential jitter", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempt = 0;
    const result = await retryOperation(
      async () => {
        attempt += 1;
        if (attempt < 3) {
          throw new JiraApiError({
            status: 429,
            statusText: "Too Many Requests",
            method: "GET",
            path: "/rest/api/3/search/jql",
            retryable: true,
            rateLimit: rateLimit(attempt === 1 ? 2 : null),
          });
        }
        return "ok";
      },
      {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 5_000,
        sleep,
        random: () => 0.5,
      },
    );

    expect(result).toBe("ok");
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not blind-retry non-retryable or ambiguous mutations", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("ambiguous"), { retryable: true }),
      );

    await expect(
      retryOperation(operation, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
        operationKind: "mutation",
        mutationPreconditionMaintained: false,
      }),
    ).rejects.toThrow("ambiguous");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("clamps jitter to the configured retry maximum", async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("retry"), { retryable: true }),
      )
      .mockResolvedValue("ok");

    await expect(
      retryOperation(operation, {
        maxRetries: 1,
        baseDelayMs: 10_000,
        maxDelayMs: 10_000,
        sleep,
        random: () => 1,
      }),
    ).resolves.toBe("ok");
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("aborts an in-flight Retry-After wait immediately", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(
      new JiraApiError({
        status: 429,
        statusText: "Too Many Requests",
        method: "GET",
        path: "/rest/api/3/search/jql",
        retryable: true,
        rateLimit: rateLimit(3_600),
      }),
    );
    const pending = retryOperation(operation, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5_000,
      signal: controller.signal,
      abortError: () => new Error("interrupted"),
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow("interrupted");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
