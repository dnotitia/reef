// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockCreateAdapter, mockUpdateView, mockDeleteView } = vi.hoisted(
  () => ({
    mockCreateAdapter: vi.fn(),
    mockUpdateView: vi.fn(),
    mockDeleteView: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createAkbAdapter: mockCreateAdapter,
    akbUpdateSavedIssueView: mockUpdateView,
    akbDeleteSavedIssueView: mockDeleteView,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { ConflictError } from "@reef/core";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { DELETE, PATCH } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const headers = {
  cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
  "Content-Type": "application/json",
};
const context = { params: Promise.resolve({ id }) };

describe("/api/views/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects a non-UUID id before reaching core", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/views/not-an-id?vault=reef-acme", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: Promise.resolve({ id: "not-an-id" }) },
    );
    expect(response.status).toBe(400);
    expect(mockUpdateView).not.toHaveBeenCalled();
  });

  it("patches the requested row and maps duplicate rename to 409", async () => {
    mockUpdateView.mockRejectedValue(new ConflictError());
    const response = await PATCH(
      new Request(`http://localhost/api/views/${id}?vault=reef-acme`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Duplicate" }),
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(mockUpdateView).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        vault: "reef-acme",
        patch: { name: "Duplicate" },
      }),
    );
  });

  it("deletes the requested row", async () => {
    mockDeleteView.mockResolvedValue(undefined);
    const response = await DELETE(
      new Request(`http://localhost/api/views/${id}?vault=reef-acme`, {
        method: "DELETE",
        headers,
      }),
      context,
    );
    expect(response.status).toBe(204);
    expect(mockDeleteView).toHaveBeenCalledWith(
      expect.objectContaining({ id, vault: "reef-acme" }),
    );
  });
});
