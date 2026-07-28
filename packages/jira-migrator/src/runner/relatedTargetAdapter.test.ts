import { AkbApiError } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import { createAkbRelatedTarget } from "./relatedTargetAdapter.js";

describe("AKB Jira related target", () => {
  it("retries transient AKB read failures without retrying a mutation", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new AkbApiError({ status: 503, message: "temporarily unavailable" }),
      )
      .mockRejectedValueOnce(
        new AkbApiError({ status: 503, message: "temporarily unavailable" }),
      )
      .mockResolvedValue({
        kind: "table_query",
        items: [{ idempotency_key: "jira-remote:cloud:1:key" }],
      });
    const waitForConsistency = vi.fn(async () => undefined);
    const { related } = createAkbRelatedTarget({
      adapter: { request },
      vault: "reef-test",
      waitForConsistency,
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await expect(
      related.listExternalRefKeys("jira-remote:cloud:1:"),
    ).resolves.toEqual(["jira-remote:cloud:1:key"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(waitForConsistency).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(
        ([, init]) =>
          init &&
          typeof init === "object" &&
          "body" in init &&
          typeof init.body === "object" &&
          init.body !== null &&
          "sql" in init.body &&
          String(init.body.sql).startsWith("SELECT"),
      ),
    ).toBe(true);
  });
});
