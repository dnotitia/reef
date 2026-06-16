// @vitest-environment node

import { RequestError } from "@octokit/request-error";
import {
  AuthError,
  GitHubApiError,
  NotFoundError,
  translateError,
} from "@reef/core";
import { describe, expect, it } from "vitest";
import { mapRequestError } from "./mapRequestError";

const REQUEST = {
  method: "GET",
  url: "https://api.github.com/user/repos",
  headers: { authorization: "token ghp_secret" },
} as const;

function requestError(
  status: number,
  message = `HTTP ${status}`,
): RequestError {
  return new RequestError(message, status, { request: { ...REQUEST } });
}

function structuralHttpError(
  status: number,
  message = `HTTP ${status}`,
): Error {
  return Object.assign(new Error(message), {
    name: "HttpError",
    status,
    request: { ...REQUEST },
  });
}

describe("mapRequestError", () => {
  it("401 → AuthError", () => {
    expect(mapRequestError(requestError(401))).toBeInstanceOf(AuthError);
  });

  it("403 → GitHubApiError carrying the status", async () => {
    const mapped = mapRequestError(requestError(403));
    expect(mapped).toBeInstanceOf(GitHubApiError);
    expect((mapped as GitHubApiError).status).toBe(403);
    const res = translateError(mapped);
    expect(res.status).toBe(403);
  });

  it("maps Octokit HttpError shape across RequestError package versions", () => {
    const mapped = mapRequestError(structuralHttpError(403));
    expect(mapped).toBeInstanceOf(GitHubApiError);
    expect((mapped as GitHubApiError).status).toBe(403);
  });

  it("404 → NotFoundError (repository)", () => {
    const mapped = mapRequestError(requestError(404));
    expect(mapped).toBeInstanceOf(NotFoundError);
    expect(mapped?.toUserMessage().toLowerCase()).toContain("repository");
  });

  it("other status → GitHubApiError carrying the status", () => {
    const mapped = mapRequestError(requestError(502));
    expect(mapped).toBeInstanceOf(GitHubApiError);
    expect((mapped as GitHubApiError).status).toBe(502);
  });

  it("non-RequestError → null (caller falls through to unknown → 500)", () => {
    expect(mapRequestError(new Error("boom"))).toBeNull();
    expect(
      mapRequestError(Object.assign(new Error("boom"), { status: 403 })),
    ).toBeNull();
    expect(mapRequestError("nope")).toBeNull();
    expect(mapRequestError(null)).toBeNull();
  });

  it("never leaks the raw RequestError message into user copy", async () => {
    const mapped = mapRequestError(
      requestError(500, "secret upstream: token ghp_secret leaked"),
    );
    const res = translateError(mapped);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("ghp_secret");
    expect(body.error).not.toContain("secret upstream");
  });
});
