import { describe, expect, it } from "vitest";
import {
  ActivitySuggestionError,
  AkbApiError,
  AuthError,
  ConflictError,
  GitHubApiError,
  LlmError,
  NotFoundError,
  ReefError,
  SchemaValidationError,
  translateError,
} from ".";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GIT_VOCABULARY = [
  "merge conflict",
  "rebase",
  " sha",
  " oid",
  " git ",
  "graphql",
  "octokit",
  "api key",
];

function assertNoPmViolations(msg: string) {
  const lower = msg.toLowerCase();
  for (const term of GIT_VOCABULARY) {
    expect(lower, `toUserMessage() must not contain "${term}"`).not.toContain(
      term,
    );
  }
}

// ─── SchemaValidationError ────────────────────────────────────────────────────

describe("SchemaValidationError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new SchemaValidationError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
    expect(err).toBeInstanceOf(SchemaValidationError);
  });

  it("has name = 'SchemaValidationError'", () => {
    expect(new SchemaValidationError().name).toBe("SchemaValidationError");
  });

  it("toUserMessage() returns non-empty PM-vocabulary string (no field)", () => {
    const msg = new SchemaValidationError().toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
    expect(msg).toContain("one or more fields");
  });

  it("toUserMessage() includes field name when provided", () => {
    const msg = new SchemaValidationError({ field: "status" }).toUserMessage();
    expect(msg).toContain("status");
    assertNoPmViolations(msg);
  });

  it("error.message equals toUserMessage()", () => {
    const err = new SchemaValidationError({ field: "title" });
    expect(err.message).toBe(err.toUserMessage());
  });

  it("resourceKind drives curated copy", () => {
    expect(
      new SchemaValidationError({ resourceKind: "template" }).toUserMessage(),
    ).toContain("template");
    expect(
      new SchemaValidationError({ resourceKind: "config" }).toUserMessage(),
    ).toContain("config");
  });
});

// ─── GitHubApiError ───────────────────────────────────────────────────────────

describe("GitHubApiError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new GitHubApiError({ status: 500, message: "server error" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
  });

  it("has name = 'GitHubApiError'", () => {
    expect(new GitHubApiError({ status: 404, message: "not found" }).name).toBe(
      "GitHubApiError",
    );
  });

  it("toUserMessage() for 401/403 contains PM-vocabulary auth message", () => {
    const msg = new GitHubApiError({
      status: 401,
      message: "",
    }).toUserMessage();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("authentication");
  });

  it("toUserMessage() for 404 contains not-found message", () => {
    const msg = new GitHubApiError({
      status: 404,
      message: "",
    }).toUserMessage();
    assertNoPmViolations(msg);
  });

  it("toUserMessage() for 409 contains save conflict message", () => {
    const msg = new GitHubApiError({
      status: 409,
      message: "",
    }).toUserMessage();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("save conflict");
  });

  it("toUserMessage() for other status codes returns generic message", () => {
    const msg = new GitHubApiError({
      status: 500,
      message: "",
    }).toUserMessage();
    assertNoPmViolations(msg);
    expect(msg).toBeTruthy();
  });
});

// ─── LlmError ────────────────────────────────────────────────────────────────

describe("LlmError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new LlmError({ message: "timeout" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
  });

  it("has name = 'LlmError'", () => {
    expect(new LlmError({ message: "" }).name).toBe("LlmError");
  });

  it("toUserMessage() returns non-empty PM-vocabulary string", () => {
    const msg = new LlmError({ message: "timeout" }).toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("unavailable");
  });

  it("error.message equals toUserMessage()", () => {
    const err = new LlmError({ message: "timeout" });
    expect(err.message).toBe(err.toUserMessage());
  });
});

// ─── ConflictError ────────────────────────────────────────────────────────────

describe("ConflictError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new ConflictError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
  });

  it("has name = 'ConflictError'", () => {
    expect(new ConflictError().name).toBe("ConflictError");
  });

  it("toUserMessage() contains save conflict PM vocabulary", () => {
    const msg = new ConflictError().toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("save conflict");
  });

  it("toUserMessage() accepts optional path context", () => {
    const msg = new ConflictError({
      path: "issues/reef-001.md",
    }).toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
  });

  it("error.message equals toUserMessage()", () => {
    const err = new ConflictError();
    expect(err.message).toBe(err.toUserMessage());
  });
});

// ─── AuthError ────────────────────────────────────────────────────────────────

describe("AuthError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new AuthError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
  });

  it("has name = 'AuthError'", () => {
    expect(new AuthError().name).toBe("AuthError");
  });

  it("toUserMessage() returns origin-neutral auth message (not workspace-session-specific)", () => {
    const msg = new AuthError().toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("authentication");
    expect(msg.toLowerCase()).toContain("sign in");
    // should not misdirect a GitHub-origin auth failure to re-sign into the workspace.
    expect(msg.toLowerCase()).not.toContain("session");
  });

  it("error.message equals toUserMessage()", () => {
    const err = new AuthError();
    expect(err.message).toBe(err.toUserMessage());
  });
});

// ─── NotFoundError ────────────────────────────────────────────────────────────

describe("NotFoundError", () => {
  it("is an instance of Error and ReefError", () => {
    const err = new NotFoundError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReefError);
  });

  it("has name = 'NotFoundError'", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
  });

  it("toUserMessage() uses 'item' as default resource", () => {
    const msg = new NotFoundError().toUserMessage();
    expect(msg).toBeTruthy();
    assertNoPmViolations(msg);
    expect(msg.toLowerCase()).toContain("item");
  });

  it("toUserMessage() includes resource name when provided", () => {
    const msg = new NotFoundError({ resource: "issue" }).toUserMessage();
    expect(msg).toContain("issue");
    assertNoPmViolations(msg);
  });

  it("resourceKind drives curated copy", () => {
    expect(new NotFoundError({ resourceKind: "issue" }).toUserMessage()).toBe(
      "Issue not found.",
    );
    expect(
      new NotFoundError({ resourceKind: "template" }).toUserMessage(),
    ).toBe("Template not found.");
    expect(
      new NotFoundError({ resourceKind: "config" }).toUserMessage(),
    ).toContain("Check the selected vault");
  });

  it("free-form resource WITHOUT resourceKind stays generic (id not leaked as a label key)", () => {
    const msg = new NotFoundError({
      resource: "issue REEF-999",
    }).toUserMessage();
    expect(msg).toBe("The requested issue REEF-999 could not be found.");
  });

  it("resourceKind suppresses free-form resource interpolation", () => {
    const msg = new NotFoundError({
      resource: "issue REEF-999",
      resourceKind: "issue",
    }).toUserMessage();
    expect(msg).toBe("Issue not found.");
    expect(msg).not.toContain("REEF-999");
  });

  it("error.message equals toUserMessage()", () => {
    const err = new NotFoundError({ resource: "repository" });
    expect(err.message).toBe(err.toUserMessage());
  });
});

// ─── translateError ───────────────────────────────────────────────────────────

describe("translateError", () => {
  it("ConflictError → 409", async () => {
    const res = translateError(new ConflictError());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("AuthError → 401", async () => {
    const res = translateError(new AuthError());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("NotFoundError → 404", async () => {
    const res = translateError(new NotFoundError());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("SchemaValidationError → 422", async () => {
    const res = translateError(new SchemaValidationError());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("LlmError → 503", async () => {
    const res = translateError(new LlmError({ message: "timeout" }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("GitHubApiError 401 → 401", async () => {
    const res = translateError(
      new GitHubApiError({ status: 401, message: "" }),
    );
    expect(res.status).toBe(401);
  });

  it("GitHubApiError 403 → 403", async () => {
    const res = translateError(
      new GitHubApiError({ status: 403, message: "" }),
    );
    expect(res.status).toBe(403);
  });

  it("GitHubApiError 404 → 404", async () => {
    const res = translateError(
      new GitHubApiError({ status: 404, message: "" }),
    );
    expect(res.status).toBe(404);
  });

  it("GitHubApiError 409 → 409", async () => {
    const res = translateError(
      new GitHubApiError({ status: 409, message: "" }),
    );
    expect(res.status).toBe(409);
  });

  it("GitHubApiError 500 → 502", async () => {
    const res = translateError(
      new GitHubApiError({ status: 500, message: "" }),
    );
    expect(res.status).toBe(502);
  });

  // AkbApiError pass-through is a POLICY-PRIMITIVE guard: the akb HTTP adapter
  // pre-translates 401/403/404/409/422 into typed ReefErrors before any
  // AkbApiError is constructed, so the 4xx cases below do not exercise a
  // reachable adapter path — they pin the policy contract for any future
  // direct AkbApiError(4xx). 422 is in the AKB pass-through set (unlike GitHub).
  it.each([401, 403, 404, 409, 422])(
    "AkbApiError %i → pass-through",
    async (status) => {
      const res = translateError(new AkbApiError({ status, message: "" }));
      expect(res.status).toBe(status);
    },
  );

  it.each([500, 429])("AkbApiError %i → 502", async (status) => {
    const res = translateError(new AkbApiError({ status, message: "" }));
    expect(res.status).toBe(502);
  });

  it("AkbApiError body suppresses raw upstream message (generic copy only)", async () => {
    const res = translateError(
      new AkbApiError({ status: 500, message: "raw postgres: relation x" }),
    );
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("postgres");
    expect(body.error).not.toContain("relation x");
  });

  it("ActivitySuggestionError → its httpStatus", async () => {
    const res = translateError(new ActivitySuggestionError("dismissed"));
    expect(res.status).toBe(409);
    const stale = translateError(
      new ActivitySuggestionError("prefix_required"),
    );
    expect(stale.status).toBe(400);
  });

  it("SchemaValidationError omits details by default (akb-origin issues stay log-only)", async () => {
    const res = translateError(
      new SchemaValidationError({ issues: ["raw fastapi text"] }),
    );
    const body = (await res.json()) as { error: string; details?: string[] };
    expect(body.details).toBeUndefined();
  });

  it("SchemaValidationError surfaces details only when clientValidated", async () => {
    const res = translateError(
      new SchemaValidationError({
        issues: ["title is required"],
        clientValidated: true,
      }),
    );
    const body = (await res.json()) as { error: string; details?: string[] };
    expect(body.details).toEqual(["title is required"]);
  });

  it("unknown error → 500", async () => {
    const res = translateError(new Error("unexpected"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toMatchObject({ error: "An unexpected error occurred." });
  });

  it("non-Error unknown → 500", async () => {
    const res = translateError("some string error");
    expect(res.status).toBe(500);
  });

  it("response body has { error: string } shape", async () => {
    const res = translateError(new ConflictError());
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("uses toUserMessage() value in response body", async () => {
    const err = new ConflictError();
    const res = translateError(err);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(err.toUserMessage());
  });
});
