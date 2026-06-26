// @vitest-environment node
import { AgentArtifactCommandError } from "@/lib/api/agentArtifactReview";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drive the request locale through `next/headers`, mirroring
 * `errorLocalization.test.ts`: a `NEXT_LOCALE` cookie selects the locale and an
 * absent cookie exercises the en fallback that keeps locale-unaware tests green.
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

import { agentArtifactCommandErrorResponse } from "./commandRouteHelpers";

async function agentBodyOf(res: Response): Promise<{
  error: string;
  runtime_error: { code: string; message: string; recoverable: boolean };
}> {
  return (await res.json()) as {
    error: string;
    runtime_error: { code: string; message: string; recoverable: boolean };
  };
}

beforeEach(() => {
  cookieLocale.current = undefined;
});

describe("agentArtifactCommandErrorResponse — code → locale (REEF-308 AC3/AC4)", () => {
  it("returns null for a non-AgentArtifactCommandError", () => {
    expect(agentArtifactCommandErrorResponse(new Error("nope"))).toBeNull();
  });

  it("resolves the stable code to the active locale, keeping the code", async () => {
    cookieLocale.current = "ko";
    const res = await (agentArtifactCommandErrorResponse(
      new AgentArtifactCommandError(
        "This artifact has already been reviewed.",
        409,
        "artifact_already_reviewed",
        { artifact_id: "artifact-1" },
      ),
    ) as Promise<Response>);
    expect(res.status).toBe(409);
    const body = await agentBodyOf(res);
    expect(body.error).toBe("이미 검토한 아티팩트입니다.");
    expect(body.runtime_error.code).toBe("artifact_already_reviewed");
    expect(body.runtime_error.message).toBe("이미 검토한 아티팩트입니다.");
  });

  it("maps a multi-underscore code to its camelCase catalog key", async () => {
    cookieLocale.current = "ko";
    const res = await (agentArtifactCommandErrorResponse(
      new AgentArtifactCommandError(
        "Artifact command could not find the derived activity suggestion.",
        409,
        "activity_suggestion_not_found",
      ),
    ) as Promise<Response>);
    // Both the "referenced" and "derived" sources share one code, so the
    // PM-facing message unifies under the single localized key (AC3).
    expect((await agentBodyOf(res)).error).toBe(
      "아티팩트 명령이 참조된 활동 제안을 찾지 못했습니다.",
    );
  });

  it("falls back to en for the catalog when no locale is set", async () => {
    const res = await (agentArtifactCommandErrorResponse(
      new AgentArtifactCommandError(
        "This artifact has already been reviewed.",
        409,
        "artifact_already_reviewed",
      ),
    ) as Promise<Response>);
    expect((await agentBodyOf(res)).error).toBe(
      "This artifact has already been reviewed.",
    );
  });

  it("falls back to the carried English message for an unmapped code", async () => {
    cookieLocale.current = "ko";
    const res = await (agentArtifactCommandErrorResponse(
      new AgentArtifactCommandError(
        "A future error with no catalog entry.",
        400,
        "some_future_code",
      ),
    ) as Promise<Response>);
    expect((await agentBodyOf(res)).error).toBe(
      "A future error with no catalog entry.",
    );
  });
});
