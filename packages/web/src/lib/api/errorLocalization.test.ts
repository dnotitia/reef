// @vitest-environment node
import { AuthError, LlmError, NotFoundError } from "@reef/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Control the request locale by mocking `next/headers`: a `NEXT_LOCALE` cookie
 * drives the detection chain, and an absent cookie exercises the en fallback —
 * the same fallback that keeps locale-unaware route tests green.
 */
const cookieLocale = { current: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "NEXT_LOCALE" && cookieLocale.current
          ? { value: cookieLocale.current }
          : undefined,
    }),
  headers: () => Promise.resolve({ get: () => null }),
}));

import { localizeError, localizedErrorResponse } from "./errorLocalization";

async function bodyOf(
  res: Response,
): Promise<{ error: string; details?: unknown }> {
  return (await res.json()) as { error: string; details?: unknown };
}

beforeEach(() => {
  cookieLocale.current = undefined;
});

describe("localizeError — core error path (AC1, AC2, AC4)", () => {
  it("resolves a core error code to the ko locale", async () => {
    cookieLocale.current = "ko";
    const res = await localizeError(
      new NotFoundError({ resourceKind: "issue" }),
    );
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error).toBe("이슈를 찾을 수 없습니다.");
  });

  it("falls back to en when no locale cookie is set (AC3)", async () => {
    const res = await localizeError(new AuthError());
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toBe(
      "Authentication failed. Please sign in again.",
    );
  });

  it("interpolates ICU params in the active locale", async () => {
    cookieLocale.current = "ko";
    const res = await localizeError(new NotFoundError());
    expect((await bodyOf(res)).error).toBe(
      "요청하신 item 항목을 찾을 수 없습니다.",
    );
  });

  it("keeps the { error } body shape + status for the client toast", async () => {
    cookieLocale.current = "ko";
    const res = await localizeError(new LlmError({ message: "x" }));
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).error).toBe(
      "AI 서비스를 사용할 수 없습니다. 다시 시도하거나 LLM 설정을 확인해 주세요.",
    );
  });
});

describe("localizedErrorResponse — web-boundary keys (AC1)", () => {
  it("localizes a web-boundary key into the active locale", async () => {
    cookieLocale.current = "ko";
    const res = await localizedErrorResponse("sessionExpired", 401);
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toBe(
      "세션이 만료되었습니다. 다시 로그인해 주세요.",
    );
  });

  it("falls back to en and passes structured details through untouched", async () => {
    const res = await localizedErrorResponse("invalidBody", 400, {
      details: { fieldErrors: { title: ["required"] } },
    });
    const body = await bodyOf(res);
    expect(body.error).toBe("Invalid request body.");
    expect(body.details).toEqual({ fieldErrors: { title: ["required"] } });
  });
});
