// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { closeMock, currentActorMock, getAdapterMock, requireWriterMock } =
  vi.hoisted(() => ({
    closeMock: vi.fn(),
    currentActorMock: vi.fn(),
    getAdapterMock: vi.fn(),
    requireWriterMock: vi.fn(),
  }));

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("@/lib/api/requestHelpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/requestHelpers")
  >("@/lib/api/requestHelpers");
  return {
    ...actual,
    getAkbAdapter: getAdapterMock,
    getAkbCurrentActor: currentActorMock,
    requireVaultWriter: requireWriterMock,
  };
});

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return { ...actual, akbCloseSprintAndRollover: closeMock };
});

import { POST } from "./route";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function routeParams(id = SOURCE_ID) {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request(
    `https://reef.test/api/planning/sprints/${SOURCE_ID}/close`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdapterMock.mockReturnValue({ adapter: { request: vi.fn() } });
  requireWriterMock.mockResolvedValue({ writer: true });
  currentActorMock.mockResolvedValue({ actor: "alice" });
  closeMock.mockResolvedValue({
    status: "completed",
    source_sprint_id: SOURCE_ID,
    target_sprint_id: TARGET_ID,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/planning/sprints/[id]/close", () => {
  it("checks writer access and passes a server-owned actor/source to core", async () => {
    const response = await POST(
      request({
        vault: "reef-acme",
        end_date: "2026-09-11",
        target: { kind: "existing", id: TARGET_ID },
      }),
      routeParams(),
    );

    expect(response.status).toBe(200);
    expect(requireWriterMock).toHaveBeenCalledWith(
      expect.any(Object),
      "reef-acme",
    );
    expect(closeMock).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      vault: "reef-acme",
      sourceSprintId: SOURCE_ID,
      endDate: "2026-09-11",
      target: { kind: "existing", id: TARGET_ID },
      actor: "alice",
      source: "user:sprint_rollover",
    });
  });

  it("rejects a reader before invoking the mutation", async () => {
    requireWriterMock.mockResolvedValueOnce({
      response: Response.json(
        { error: "edit access required" },
        { status: 403 },
      ),
    });

    const response = await POST(
      request({
        vault: "reef-acme",
        end_date: "2026-09-11",
        target: { kind: "existing", id: TARGET_ID },
      }),
      routeParams(),
    );

    expect(response.status).toBe(403);
    expect(closeMock).not.toHaveBeenCalled();
    expect(currentActorMock).not.toHaveBeenCalled();
  });

  it("rejects malformed source ids and invalid bodies before any write", async () => {
    const invalidIdResponse = await POST(
      request({
        vault: "reef-acme",
        end_date: "2026-09-11",
        target: { kind: "existing", id: TARGET_ID },
      }),
      routeParams("not-a-uuid"),
    );
    expect(invalidIdResponse.status).toBe(400);
    expect(getAdapterMock).not.toHaveBeenCalled();

    const invalidBodyResponse = await POST(
      request({
        vault: "reef-acme",
        end_date: "2026-09-11",
        target: { kind: "existing", id: "not-a-uuid" },
      }),
      routeParams(),
    );
    expect(invalidBodyResponse.status).toBe(400);
    expect(closeMock).not.toHaveBeenCalled();
  });
});
