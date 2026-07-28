import { AkbApiError } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import { isRetryableAkbReadError, retryAkbRead } from "./akbReadRetry.js";

describe("retryAkbRead", () => {
  it.each([0, 429, 500, 503])(
    "classifies AKB status %i as retryable",
    (status) => {
      expect(
        isRetryableAkbReadError(
          new AkbApiError({ status, message: "temporarily unavailable" }),
        ),
      ).toBe(true);
    },
  );

  it("retries network transport failures and returns the recovered read", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(
        new AkbApiError({ status: 0, message: "connect timeout" }),
      )
      .mockResolvedValue("recovered");
    const wait = vi.fn(async () => undefined);

    await expect(retryAkbRead(read, { wait })).resolves.toBe("recovered");
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured attempt bound", async () => {
    const error = new AkbApiError({ status: 503, message: "unavailable" });
    const read = vi.fn(async () => {
      throw error;
    });
    const wait = vi.fn(async () => undefined);

    await expect(retryAkbRead(read, { wait, maxAttempts: 3 })).rejects.toBe(
      error,
    );
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
