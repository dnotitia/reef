import { describe, expect, it } from "vitest";
import {
  ActivitySuggestionError,
  AkbApiError,
  AuthError,
  ConflictError,
  ERROR_MESSAGES_EN,
  GitHubApiError,
  LlmError,
  NotFoundError,
  ReefError,
  SchemaValidationError,
  describeError,
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

// ─── describeError (the AC4 web-localization seam) ──────────────────────────────

describe("describeError", () => {
  it("ConflictError → conflict / 409", () => {
    expect(describeError(new ConflictError())).toEqual({
      code: "conflict",
      status: 409,
    });
  });

  it("AuthError → auth / 401", () => {
    expect(describeError(new AuthError())).toEqual({
      code: "auth",
      status: 401,
    });
  });

  it("NotFoundError → notFound.item / 404 with default resource param", () => {
    expect(describeError(new NotFoundError())).toEqual({
      code: "notFound.item",
      status: 404,
      params: { resource: "item" },
    });
  });

  it("NotFoundError resourceKind → curated code, no params", () => {
    expect(describeError(new NotFoundError({ resourceKind: "issue" }))).toEqual(
      {
        code: "notFound.issue",
        status: 404,
      },
    );
  });

  it("SchemaValidationError → schema.invalid / 422 with default field param", () => {
    expect(describeError(new SchemaValidationError())).toEqual({
      code: "schema.invalid",
      status: 422,
      params: { field: "one or more fields" },
    });
  });

  it("LlmError → llm.unavailable / 503", () => {
    expect(describeError(new LlmError({ message: "timeout" }))).toEqual({
      code: "llm.unavailable",
      status: 503,
    });
  });

  it.each([
    [401, "github.auth", 401],
    [403, "github.auth", 403],
    [404, "github.notFound", 404],
    [409, "github.conflict", 409],
    [500, "github.unknown", 502],
  ])("GitHubApiError %i → %s / %i", (upstream, code, status) => {
    expect(
      describeError(new GitHubApiError({ status: upstream, message: "" })),
    ).toEqual({ code, status });
  });

  // AkbApiError pass-through is a POLICY-PRIMITIVE guard: the akb HTTP adapter
  // pre-translates 401/403/404/409/422 into typed ReefErrors before any
  // AkbApiError is constructed, so the 4xx cases below do not exercise a
  // reachable adapter path — they pin the policy contract for any future
  // direct AkbApiError(4xx). 422 is in the AKB pass-through set (unlike GitHub).
  it.each([401, 403, 404, 409, 422])(
    "AkbApiError %i → pass-through status",
    (status) => {
      expect(
        describeError(new AkbApiError({ status, message: "" })).status,
      ).toBe(status);
    },
  );

  it.each([500, 429])("AkbApiError %i → 502", (status) => {
    expect(describeError(new AkbApiError({ status, message: "" })).status).toBe(
      502,
    );
  });

  it("AkbApiError carries a code only — no raw upstream message (AC4)", () => {
    const descriptor = describeError(
      new AkbApiError({ status: 500, message: "raw postgres: relation x" }),
    );
    expect(descriptor).toEqual({ code: "akb.unknown", status: 502 });
    expect(JSON.stringify(descriptor)).not.toContain("postgres");
  });

  it("ActivitySuggestionError → its code + httpStatus", () => {
    expect(describeError(new ActivitySuggestionError("dismissed"))).toEqual({
      code: "activitySuggestion.dismissed",
      status: 409,
    });
    expect(
      describeError(new ActivitySuggestionError("prefix_required")),
    ).toEqual({ code: "activitySuggestion.prefixRequired", status: 400 });
  });

  it("SchemaValidationError omits details by default (akb-origin issues stay log-only)", () => {
    const descriptor = describeError(
      new SchemaValidationError({ issues: ["raw fastapi text"] }),
    );
    expect(descriptor.details).toBeUndefined();
  });

  it("SchemaValidationError surfaces details only when clientValidated", () => {
    const descriptor = describeError(
      new SchemaValidationError({
        issues: ["title is required"],
        clientValidated: true,
      }),
    );
    expect(descriptor.details).toEqual(["title is required"]);
  });

  it("unknown error → unknown / 500", () => {
    expect(describeError(new Error("unexpected"))).toEqual({
      code: "unknown",
      status: 500,
    });
  });

  it("non-Error unknown → unknown / 500", () => {
    expect(describeError("some string error")).toEqual({
      code: "unknown",
      status: 500,
    });
  });

  it("carries a stable code, never message text (AC4)", () => {
    const descriptor = describeError(new ConflictError());
    expect(descriptor.code).toBe("conflict");
    expect(descriptor).not.toHaveProperty("message");
    expect(descriptor).not.toHaveProperty("error");
  });

  it("every described code resolves to a non-empty en base string", () => {
    const errors: unknown[] = [
      new ConflictError(),
      new AuthError(),
      new NotFoundError(),
      new NotFoundError({ resourceKind: "template" }),
      new SchemaValidationError(),
      new SchemaValidationError({ resourceKind: "config" }),
      new LlmError({ message: "" }),
      new GitHubApiError({ status: 500, message: "" }),
      new AkbApiError({ status: 404, message: "" }),
      new ActivitySuggestionError("stale"),
      new Error("boom"),
    ];
    for (const err of errors) {
      const { code } = describeError(err);
      const resolved = code
        .split(".")
        .reduce<unknown>(
          (node, segment) => (node as Record<string, unknown>)?.[segment],
          ERROR_MESSAGES_EN,
        );
      expect(typeof resolved, code).toBe("string");
      expect((resolved as string).length, code).toBeGreaterThan(0);
    }
  });
});
