import { describe, expect, it } from "vitest";
import { AuthError } from "@reef/core";
import { errorFields, waitForDrain } from "./main.js";

describe("safe processor error fields", () => {
  it("logs only the auth origin and valid upstream status", () => {
    const error = new AuthError({
      origin: "akb",
      status: 403,
      code: "upstream-secret",
      message: "response body secret",
    });

    expect(errorFields(error)).toEqual({
      error_name: "AuthError",
      error_origin: "akb",
      upstream_status: 403,
    });
  });

  it("omits invalid auth status values", () => {
    expect(
      errorFields(new AuthError({ origin: "github", status: 999 })),
    ).toEqual({
      error_name: "AuthError",
      error_origin: "github",
    });
  });
});

describe("processor shutdown drain", () => {
  it("waits for bounded work to finish before returning", async () => {
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const draining = waitForDrain(running, 100);
    finish();

    await expect(draining).resolves.toBe(true);
  });

  it("reports a handler that exceeds the shutdown grace", async () => {
    const running = new Promise<void>(() => undefined);
    await expect(waitForDrain(running, 10)).resolves.toBe(false);
  });
});
