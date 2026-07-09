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
  mockListAttachments,
  mockUploadAttachment,
  mockGetActor,
  mockCreateAdapter,
} = vi.hoisted(() => ({
  mockListAttachments: vi.fn(),
  mockUploadAttachment: vi.fn(),
  mockGetActor: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListIssueAttachments: mockListAttachments,
    akbUploadIssueAttachment: mockUploadAttachment,
    akbGetCurrentActor: mockGetActor,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { GET, POST } from "./route";

const ATTACHMENT = {
  id: "att-1",
  reef_id: "REEF-001",
  file_uri: "akb://reef-test/issues/file/file-1",
  filename: "screen.png",
  mime_type: "image/png",
  size_bytes: 3,
  author: "alice",
  created_at: "2026-07-09T01:00:00.000Z",
  source: "issue_body",
  inline: true,
  original_jira_attachment_id: null,
  meta: null,
};

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function params(id = "REEF-001") {
  return { params: Promise.resolve({ id }) };
}

function formWithFile(file: File, extras: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(extras)) {
    form.set(key, value);
  }
  return form;
}

function streamRequest(
  headers: Record<string, string>,
  chunk = new Uint8Array([1, 2, 3]),
) {
  let pulled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled = true;
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const request = new Request(
    "http://localhost/api/issues/REEF-001/attachments?vault=v",
    {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  return { request, wasPulled: () => pulled };
}

function sentinelRequest(headers: Record<string, string>) {
  let bodyAccessed = false;
  const request = Object.create(Request.prototype) as Request;
  Object.defineProperties(request, {
    url: {
      value: "http://localhost/api/issues/REEF-001/attachments?vault=v",
    },
    method: { value: "POST" },
    headers: { value: new Headers(headers) },
    body: {
      get() {
        bodyAccessed = true;
        throw new Error("body should not be read");
      },
    },
  });
  return { request, wasBodyAccessed: () => bodyAccessed };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockGetActor.mockResolvedValue({ actor: "alice" });
  mockListAttachments.mockResolvedValue([ATTACHMENT]);
  mockUploadAttachment.mockResolvedValue(ATTACHMENT);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/[id]/attachments", () => {
  it("returns issue attachments", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/attachments?vault=v", {
        headers: authedHeaders(),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attachments: [ATTACHMENT] });
    expect(mockListAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
    );
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/attachments", {
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockListAttachments).not.toHaveBeenCalled();
  });
});

describe("POST /api/issues/[id]/attachments", () => {
  it("401s missing sessions before reading the multipart body", async () => {
    const { request, wasBodyAccessed } = sentinelRequest({
      "content-type": "multipart/form-data; boundary=x",
    });

    const res = await POST(request, params());

    expect(res.status).toBe(401);
    expect(wasBodyAccessed()).toBe(false);
    expect(mockGetActor).not.toHaveBeenCalled();
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });

  it("uploads an image from the session actor and returns image markdown", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", {
      type: "image/png",
    });
    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/attachments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: formWithFile(file, { source: "issue_body", inline: "true" }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      attachment: ATTACHMENT,
      markdown: "![screen.png](akb://reef-test/issues/file/file-1)",
    });
    expect(mockUploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        reefId: "REEF-001",
        vault: "v",
        filename: "screen.png",
        mimeType: "image/png",
        author: "alice",
        source: "issue_body",
        inline: true,
      }),
    );
  });

  it("returns null markdown for non-image files", async () => {
    mockUploadAttachment.mockResolvedValue({
      ...ATTACHMENT,
      filename: "notes.txt",
      mime_type: "text/plain",
      inline: false,
    });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/attachments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: formWithFile(file, { source: "comment", inline: "false" }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).markdown).toBeNull();
  });

  it("413s oversized content-length before reading the multipart body", async () => {
    vi.stubEnv("REEF_ATTACHMENT_MAX_BYTES", "1");
    const { request, wasBodyAccessed } = sentinelRequest({
      ...authedHeaders(),
      "content-type": "multipart/form-data; boundary=x",
      "content-length": "70000",
    });

    const res = await POST(request, params());

    expect(res.status).toBe(413);
    expect(wasBodyAccessed()).toBe(false);
    expect(mockGetActor).not.toHaveBeenCalled();
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });

  it("413s oversized streams without a content-length", async () => {
    vi.stubEnv("REEF_ATTACHMENT_MAX_BYTES", "1");
    const { request, wasPulled } = streamRequest(
      {
        ...authedHeaders(),
        "content-type": "multipart/form-data; boundary=x",
      },
      new Uint8Array(70000),
    );

    const res = await POST(request, params());

    expect(res.status).toBe(413);
    expect(wasPulled()).toBe(true);
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });

  it("413s files above the deployment limit", async () => {
    vi.stubEnv("REEF_ATTACHMENT_MAX_BYTES", "1");
    const file = new File([new Uint8Array([1, 2])], "screen.png", {
      type: "image/png",
    });

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/attachments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: formWithFile(file),
      }),
      params(),
    );

    expect(res.status).toBe(413);
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });

  it("415s disallowed MIME types", async () => {
    const file = new File(["x"], "tool.exe", {
      type: "application/x-msdownload",
    });

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/attachments?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: formWithFile(file),
      }),
      params(),
    );

    expect(res.status).toBe(415);
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });
});
