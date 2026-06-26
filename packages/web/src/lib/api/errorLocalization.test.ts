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

import {
  agentErrorEnvelope,
  localizeError,
  localizedAgentError,
  localizedErrorResponse,
} from "./errorLocalization";

async function bodyOf(
  res: Response,
): Promise<{ error: string; details?: unknown }> {
  return (await res.json()) as { error: string; details?: unknown };
}

async function agentBodyOf(res: Response): Promise<{
  error: string;
  runtime_error: {
    code: string;
    message: string;
    recoverable: boolean;
    details?: Record<string, unknown>;
  };
}> {
  return (await res.json()) as {
    error: string;
    runtime_error: {
      code: string;
      message: string;
      recoverable: boolean;
      details?: Record<string, unknown>;
    };
  };
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

  it("localizes a REEF-308 inline deployment/validation key (AC1)", async () => {
    cookieLocale.current = "ko";
    const unconfigured = await localizedErrorResponse(
      "githubAppUnconfigured",
      503,
    );
    expect(unconfigured.status).toBe(503);
    expect((await bodyOf(unconfigured)).error).toBe(
      "이 배포에는 GitHub App이 설정되어 있지 않습니다.",
    );
    const invalidId = await localizedErrorResponse("invalidSuggestionId", 400);
    expect((await bodyOf(invalidId)).error).toBe("잘못된 제안 ID입니다.");
  });
});

describe("localizedAgentError — agent streaming envelope (REEF-308 AC2)", () => {
  it("localizes the message in both error and runtime_error.message, keeping the code", async () => {
    cookieLocale.current = "ko";
    const res = await localizedAgentError(
      "agent.runRequestInvalid",
      400,
      "invalid_json_body",
    );
    expect(res.status).toBe(400);
    const body = await agentBodyOf(res);
    expect(body.error).toBe("에이전트 실행 요청이 없거나 올바르지 않습니다.");
    expect(body.runtime_error.code).toBe("invalid_json_body");
    expect(body.runtime_error.message).toBe(
      "에이전트 실행 요청이 없거나 올바르지 않습니다.",
    );
    // recoverable stays status-derived (<500 → false), unchanged by i18n.
    expect(body.runtime_error.recoverable).toBe(false);
  });

  it("marks 5xx envelopes recoverable and resolves a shared flat key", async () => {
    cookieLocale.current = "ko";
    const res = await localizedAgentError(
      "aiUnavailableDeployment",
      503,
      "llm_unavailable",
    );
    const body = await agentBodyOf(res);
    expect(body.error).toBe(
      "이 배포에서는 AI 서비스를 사용할 수 없습니다. 관리자에게 문의해 주세요.",
    );
    expect(body.runtime_error.recoverable).toBe(true);
  });

  it("falls back to en for the envelope when no locale is set (AC3)", async () => {
    const res = await localizedAgentError(
      "agent.runRequestInvalid",
      400,
      "invalid_agent_run_request",
    );
    expect((await agentBodyOf(res)).error).toBe(
      "Agent run request is missing or invalid.",
    );
  });

  it("falls back to the carried literal when the catalog has no key (AC3/AC4)", async () => {
    cookieLocale.current = "ko";
    const res = await localizedAgentError(
      "agent.someUnmappedFutureCode",
      400,
      "some_unmapped_future_code",
      {},
      "Carried English fallback.",
    );
    const body = await agentBodyOf(res);
    expect(body.error).toBe("Carried English fallback.");
    expect(body.runtime_error.code).toBe("some_unmapped_future_code");
  });
});

describe("agentErrorEnvelope — shape + status-derived recoverable", () => {
  it("builds the { error, runtime_error } envelope from a literal message", async () => {
    const res = agentErrorEnvelope("boom", 500, "unexpected_error", { a: 1 });
    expect(res.status).toBe(500);
    const body = await agentBodyOf(res);
    expect(body.error).toBe("boom");
    expect(body.runtime_error).toMatchObject({
      code: "unexpected_error",
      message: "boom",
      recoverable: true,
      details: { a: 1 },
    });
  });
});
