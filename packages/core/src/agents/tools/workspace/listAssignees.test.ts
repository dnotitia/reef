import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../../errors";
import { ListAssigneesOutputSchema } from "../../../schemas/ai/tools";
import { callTool } from "../__test-helpers__/callTool";
import { makeTestAkbAdapter, setupFetch } from "../__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../__test-helpers__/otelMock";
import { createListAssigneesTool } from "./listAssignees";

mockOpenTelemetry();

const makeAdapter = makeTestAkbAdapter;

const SAMPLE_MEMBERS = [
  { username: "alice", display_name: "Alice Anderson", role: "admin" },
  { username: "bob", display_name: "Bob Brown", role: "member" },
  { username: "carol", display_name: null, role: "member" },
];

describe("createListAssigneesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls GET /api/v1/vaults/{vault}/members and maps to Collaborator shape", async () => {
    const { calls } = setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/vaults/reef-acme/members",
    );
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(result.assignees).toHaveLength(3);
    expect(result.assignees[0]).toEqual({
      login: "alice",
      name: "Alice Anderson",
      avatar_url: null,
    });
    expect(result.assignees[2]).toEqual({
      login: "carol",
      name: "carol",
      avatar_url: null,
    });
  });

  it("filters members by username/display_name substring (case insensitive)", async () => {
    setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "AL" });

    expect(result.assignees.map((a) => a.login)).toEqual(["alice"]);
  });

  it("filters by display_name substring", async () => {
    setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "brown" });

    expect(result.assignees.map((a) => a.login)).toEqual(["bob"]);
  });

  it("returns empty array when no member matches", async () => {
    setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "zzz" });

    expect(result.assignees).toEqual([]);
  });

  it("caps results at MAX_RESULTS=10", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      username: `user${i.toString().padStart(2, "0")}`,
      display_name: `User ${i}`,
      role: "member",
    }));
    setupFetch([{ body: { members: many } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "user" });

    expect(result.assignees).toHaveLength(10);
  });

  it("output validates against ListAssigneesOutputSchema", async () => {
    setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { query: "" });

    expect(ListAssigneesOutputSchema.safeParse(result).success).toBe(true);
  });

  it("propagates AuthError when akb returns 401", async () => {
    setupFetch([{ status: 401, body: { detail: "unauthorized" } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await expect(callTool(tool, { query: "" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("vault is closure-bound — input query cannot redirect to another vault", async () => {
    // Schema accepts arbitrary `query` strings; the call should still hit the
    // closure-bound vault path, does not something derived from the LLM input.
    const { calls } = setupFetch([{ body: { members: SAMPLE_MEMBERS } }]);
    const tool = createListAssigneesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await callTool(tool, { query: "../other-vault/" });

    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/vaults/reef-acme/members",
    );
  });
});
