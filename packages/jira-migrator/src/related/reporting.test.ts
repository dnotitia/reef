import { AkbApiError } from "@reef/core";
import { describe, expect, it } from "vitest";
import { failure } from "./reporting.js";

describe("related import reporting", () => {
  it("preserves retryability for transient AKB failures", () => {
    const failures: Parameters<typeof failure>[0] = [];

    failure(
      failures,
      "attachment",
      "100",
      "readback",
      "attachment_import_failed",
      new AkbApiError({ status: 503, message: "temporarily unavailable" }),
    );

    expect(failures).toEqual([
      {
        source_kind: "attachment",
        source_id: "100",
        phase: "readback",
        reason: "attachment_import_failed",
        retryable: true,
      },
    ]);
  });
});
