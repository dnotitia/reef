// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      async (
        _name: string,
        fn: (span: {
          setAttribute: () => void;
          recordException: () => void;
          setStatus: () => void;
          end: () => void;
        }) => Promise<unknown>,
      ) =>
        fn({
          setAttribute: () => {},
          recordException: () => {},
          setStatus: () => {},
          end: () => {},
        }),
    ),
  },
}));

const {
  mockUpdateComment,
  mockDeleteComment,
  mockGetActor,
  mockCreateAdapter,
} = vi.hoisted(() => ({
  mockUpdateComment: vi.fn(),
  mockDeleteComment: vi.fn(),
  mockGetActor: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbUpdateComment: mockUpdateComment,
    akbDeleteComment: mockDeleteComment,
    akbGetCurrentActor: mockGetActor,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { NotFoundError } from "@reef/core";
import { VALID_JWT } from "../../../../__test-helpers__/jwt";
import { DELETE, PATCH } from "./route";

const COMMENT_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT = {
  id: COMMENT_ID,
  reef_id: "REEF-001",
  body: "edited",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: "2026-06-18T05:00:00.000Z",
};

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

function params(id = "REEF-001", commentId = COMMENT_ID) {
  return { params: Promise.resolve({ id, commentId }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockGetActor.mockResolvedValue({ actor: "alice" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("PATCH /api/issues/[id]/comments/[commentId]", () => {
  it("edits the comment as the session actor and returns it", async () => {
    mockUpdateComment.mockResolvedValue(COMMENT);

    const res = await PATCH(
      new Request(
        `http://localhost/api/issues/REEF-001/comments/${COMMENT_ID}?vault=v`,
        {
          method: "PATCH",
          headers: authedHeaders(),
          body: JSON.stringify({ body: "edited" }),
        },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comment: COMMENT });
    expect(mockUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
      COMMENT_ID,
      "edited",
      "alice",
    );
  });

  it("404s when core reports the comment is missing or not the author's", async () => {
    mockUpdateComment.mockRejectedValue(
      new NotFoundError({ resource: `comment ${COMMENT_ID}` }),
    );

    const res = await PATCH(
      new Request(
        `http://localhost/api/issues/REEF-001/comments/${COMMENT_ID}?vault=v`,
        {
          method: "PATCH",
          headers: authedHeaders(),
          body: JSON.stringify({ body: "edited" }),
        },
      ),
      params(),
    );

    expect(res.status).toBe(404);
  });

  it("400s a malformed comment id", async () => {
    const res = await PATCH(
      new Request(
        "http://localhost/api/issues/REEF-001/comments/nope?vault=v",
        {
          method: "PATCH",
          headers: authedHeaders(),
          body: JSON.stringify({ body: "edited" }),
        },
      ),
      params("REEF-001", "nope"),
    );
    expect(res.status).toBe(400);
    expect(mockUpdateComment).not.toHaveBeenCalled();
  });

  it("400s an empty body", async () => {
    const res = await PATCH(
      new Request(
        `http://localhost/api/issues/REEF-001/comments/${COMMENT_ID}?vault=v`,
        {
          method: "PATCH",
          headers: authedHeaders(),
          body: JSON.stringify({ body: "" }),
        },
      ),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockUpdateComment).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/issues/[id]/comments/[commentId]", () => {
  it("deletes the comment as the session actor and returns only deleted ids", async () => {
    const result = { deleted_comment_ids: [COMMENT_ID, "reply-id"] };
    mockDeleteComment.mockResolvedValue(result);

    const res = await DELETE(
      new Request(
        `http://localhost/api/issues/REEF-001/comments/${COMMENT_ID}?vault=v`,
        { method: "DELETE", headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(mockDeleteComment).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
      COMMENT_ID,
      "alice",
    );
  });

  it("returns a generic 404 when core reports a missing or unauthorized comment", async () => {
    mockDeleteComment.mockRejectedValue(
      new NotFoundError({ resource: `comment ${COMMENT_ID}` }),
    );

    const res = await DELETE(
      new Request(
        `http://localhost/api/issues/REEF-001/comments/${COMMENT_ID}?vault=v`,
        { method: "DELETE", headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(404);
  });

  it("400s a malformed comment id without calling core", async () => {
    const res = await DELETE(
      new Request(
        "http://localhost/api/issues/REEF-001/comments/nope?vault=v",
        { method: "DELETE", headers: authedHeaders() },
      ),
      params("REEF-001", "nope"),
    );

    expect(res.status).toBe(400);
    expect(mockDeleteComment).not.toHaveBeenCalled();
  });
});
