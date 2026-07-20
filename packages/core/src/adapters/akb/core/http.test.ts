import { describe, expect, it } from "vitest";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { makeAdapter, setupFetch } from "../../akb.httpTestSupport";
import { AkbSearchHitSchema } from "./http";
import { isMissingTableError } from "./sql";

describe("AkbSearchHitSchema", () => {
  it("accepts a hit whose title is null (untitled akb document)", () => {
    const parsed = AkbSearchHitSchema.safeParse({
      uri: "akb://v/coll/specs/doc/y.md",
      title: null,
      source_type: "document",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a hit with a string title", () => {
    const parsed = AkbSearchHitSchema.safeParse({
      uri: "akb://v/coll/specs/doc/y.md",
      title: "Spec",
      source_type: "document",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("akb HTTP error translation (REEF-363)", () => {
  async function requestError(spec: {
    status: number;
    body: unknown;
  }): Promise<unknown> {
    setupFetch([spec]);
    const adapter = makeAdapter();
    try {
      await adapter.request("/api/v1/tables/reef-sample/sql", {
        method: "POST",
        body: { sql: "SELECT 1" },
        resource: "sql on vault reef-sample",
      });
    } catch (err) {
      return err;
    }
    throw new Error("expected adapter.request to throw");
  }

  it("extracts the message from akb's object detail envelope { message, code }", async () => {
    const err = await requestError({
      status: 400,
      body: {
        detail: {
          message: 'relation "vt_reef-sample__reef_settings" does not exist',
          code: "undefined_table",
        },
      },
    });
    expect(err).toBeInstanceOf(AkbApiError);
    expect((err as AkbApiError).context.message).toContain("does not exist");
    // The load-bearing consequence: not-yet-provisioned table degrade paths
    // still fire on akb's new 4xx error shape, not just the older 200 body.
    expect(isMissingTableError(err)).toBe(true);
  });

  it("still recognizes the legacy { error } body carried on a 4xx", async () => {
    const err = await requestError({
      status: 400,
      body: { error: 'relation "vt_reef-sample__reef_issues" does not exist' },
    });
    expect(isMissingTableError(err)).toBe(true);
  });

  it("reads FastAPI validation detail arrays ([{ msg }]) as a 422", async () => {
    const err = await requestError({
      status: 422,
      body: { detail: [{ loc: ["body", "sql"], msg: "field required" }] },
    });
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect((err as SchemaValidationError).context.issues?.[0]).toBe(
      "field required",
    );
  });

  it("reads a plain string detail", async () => {
    const err = await requestError({
      status: 400,
      body: { detail: "bad request text" },
    });
    expect((err as AkbApiError).context.message).toBe("bad request text");
  });

  it("falls back cleanly when the body carries no known message shape", async () => {
    const err = await requestError({ status: 400, body: { unexpected: true } });
    expect(err).toBeInstanceOf(AkbApiError);
    expect(isMissingTableError(err)).toBe(false);
  });

  it("maps status codes to reef error classes regardless of detail shape", async () => {
    expect(
      await requestError({
        status: 409,
        body: { detail: { message: "conflict", code: "conflict" } },
      }),
    ).toBeInstanceOf(ConflictError);
    expect(
      await requestError({
        status: 404,
        body: { detail: { message: "gone", code: "not_found" } },
      }),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await requestError({
        status: 403,
        body: { detail: { message: "denied", code: "permission_denied" } },
      }),
    ).toBeInstanceOf(AuthError);
  });

  it.each([
    [403, "membership_required"],
    [403, "account_suspended"],
    [409, "identity_conflict"],
  ])("preserves stable AKB account code %s/%s", async (status, code) => {
    const err = await requestError({
      status,
      body: {
        message: "safe account denial",
        error: "safe account denial",
        code,
        detail: { message: "safe account denial", code },
      },
    });

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).context).toMatchObject({
      origin: "akb",
      code,
      status,
    });
  });
});
