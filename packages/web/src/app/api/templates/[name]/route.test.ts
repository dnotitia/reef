// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbReadTemplate,
  mockAkbWriteTemplate,
  mockAkbDeleteTemplate,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbReadTemplate: vi.fn(),
  mockAkbWriteTemplate: vi.fn(),
  mockAkbDeleteTemplate: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbReadTemplate: mockAkbReadTemplate,
    akbWriteTemplate: mockAkbWriteTemplate,
    akbDeleteTemplate: mockAkbDeleteTemplate,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import {
  AuthError,
  NotFoundError,
  SchemaValidationError,
  type Template,
} from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { DELETE, GET, PUT } from "./route";

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

const SAMPLE_TEMPLATE: Template = {
  name: "bug",
  label: "Bug",
  description: "Bug report",
  default_labels: ["bug"],
  body: "## Repro",
};

const params = (name: string) =>
  ({ params: Promise.resolve({ name }) }) as {
    params: Promise<{ name: string }>;
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/templates/[name]", () => {
  it("returns 400 when name does not match TEMPLATE_NAME_PATTERN", async () => {
    const req = new Request(
      "http://localhost/api/templates/BadName?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("BadName"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/templates/bug", {
      headers: authedHeaders(),
    });
    const res = await GET(req, params("bug"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session cookie is missing", async () => {
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
    );
    const res = await GET(req, params("bug"));
    expect(res.status).toBe(401);
  });

  it("returns { template } on happy path", async () => {
    mockAkbReadTemplate.mockResolvedValueOnce({ template: SAMPLE_TEMPLATE });
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("bug"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template: SAMPLE_TEMPLATE });
    expect(mockAkbReadTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", name: "bug" }),
    );
  });

  it("translates NotFoundError to 404", async () => {
    mockAkbReadTemplate.mockRejectedValueOnce(
      new NotFoundError({ resource: "template bug" }),
    );
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
      { headers: authedHeaders() },
    );
    const res = await GET(req, params("bug"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/templates/[name]", () => {
  it("returns 400 when name does not match TEMPLATE_NAME_PATTERN", async () => {
    const req = new Request("http://localhost/api/templates/BadName", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        template: SAMPLE_TEMPLATE,
      }),
    });
    const res = await PUT(req, params("BadName"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when JSON body is malformed", async () => {
    const req = new Request("http://localhost/api/templates/bug", {
      method: "PUT",
      headers: authedHeaders(),
      body: "{ not-json",
    });
    const res = await PUT(req, params("bug"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body fails schema", async () => {
    const req = new Request("http://localhost/api/templates/bug", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme" }),
    });
    const res = await PUT(req, params("bug"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when URL name does not match body template.name", async () => {
    const req = new Request("http://localhost/api/templates/bug", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        template: { ...SAMPLE_TEMPLATE, name: "feature" },
      }),
    });
    const res = await PUT(req, params("bug"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Delete and create to rename");
  });

  it("calls akbWriteTemplate and returns { template } on happy path", async () => {
    mockAkbWriteTemplate.mockResolvedValueOnce(undefined);
    const req = new Request("http://localhost/api/templates/bug", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        template: SAMPLE_TEMPLATE,
      }),
    });
    const res = await PUT(req, params("bug"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template: SAMPLE_TEMPLATE });
    expect(mockAkbWriteTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        template: SAMPLE_TEMPLATE,
      }),
    );
  });

  it("translates SchemaValidationError to 422", async () => {
    mockAkbWriteTemplate.mockRejectedValueOnce(
      new SchemaValidationError({ issues: ["bad shape"] }),
    );
    const req = new Request("http://localhost/api/templates/bug", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        template: SAMPLE_TEMPLATE,
      }),
    });
    const res = await PUT(req, params("bug"));
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/templates/[name]", () => {
  it("returns 400 when name is invalid", async () => {
    const req = new Request(
      "http://localhost/api/templates/BadName?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("BadName"));
    expect(res.status).toBe(400);
  });

  it("returns 204 on successful delete", async () => {
    mockAkbDeleteTemplate.mockResolvedValueOnce(undefined);
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("bug"));
    expect(res.status).toBe(204);
    expect(mockAkbDeleteTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", name: "bug" }),
    );
  });

  it("translates NotFoundError to 404", async () => {
    mockAkbDeleteTemplate.mockRejectedValueOnce(
      new NotFoundError({ resource: "template bug" }),
    );
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("bug"));
    expect(res.status).toBe(404);
  });

  it("translates AuthError to 401", async () => {
    mockAkbDeleteTemplate.mockRejectedValueOnce(new AuthError({}));
    const req = new Request(
      "http://localhost/api/templates/bug?vault=reef-acme",
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE(req, params("bug"));
    expect(res.status).toBe(401);
  });
});
