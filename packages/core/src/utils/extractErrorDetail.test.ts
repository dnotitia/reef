import { describe, expect, it } from "vitest";
import { extractErrorDetail } from "./extractErrorDetail";

describe("extractErrorDetail", () => {
  it("handles null/undefined", () => {
    expect(extractErrorDetail(null)).toBe("Unknown error");
    expect(extractErrorDetail(undefined)).toBe("Unknown error");
  });

  it("formats a plain Error", () => {
    const detail = extractErrorDetail(new Error("boom"));
    expect(detail).toMatch(/err=Error: boom/);
  });

  it("flattens AI SDK RetryError + nested APICallError", () => {
    const apiCallError = Object.assign(new Error("Provider returned error"), {
      statusCode: 401,
      url: "https://api.example.com/v1/chat/completions",
      responseBody: '{"error":{"message":"Invalid api key"}}',
      isRetryable: true,
    });
    Object.defineProperty(apiCallError, "name", { value: "AI_APICallError" });

    const retryError = Object.assign(
      new Error("Failed after 3 attempts. Last error: Provider returned error"),
      { lastError: apiCallError, errors: [apiCallError], reason: "retry" },
    );
    Object.defineProperty(retryError, "name", { value: "AI_RetryError" });

    const detail = extractErrorDetail(retryError);
    expect(detail).toMatch(/AI_RetryError/);
    expect(detail).toMatch(/statusCode=401/);
    expect(detail).toMatch(/api\.example\.com/);
    expect(detail).toMatch(/Invalid api key/);
  });

  it("walks cause chain", () => {
    const root = Object.assign(new Error("root cause"), { code: "ECONNRESET" });
    const wrapped = Object.assign(new Error("wrapped"), { cause: root });
    const detail = extractErrorDetail(wrapped);
    expect(detail).toMatch(/wrapped/);
    expect(detail).toMatch(/root cause/);
    expect(detail).toMatch(/code=ECONNRESET/);
  });

  it("does not loop on a self-referencing cause", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    a.cause = a;
    expect(() => extractErrorDetail(a)).not.toThrow();
  });

  it("truncates very long string properties", () => {
    const big = "x".repeat(500);
    const err = Object.assign(new Error("e"), { responseBody: big });
    const detail = extractErrorDetail(err);
    expect(detail).toContain("…");
    expect(detail.length).toBeLessThan(1000);
  });
});
