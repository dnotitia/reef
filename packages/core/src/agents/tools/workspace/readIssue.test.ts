import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, NotFoundError } from "../../../errors";
import { ReadIssueOutputSchema } from "../../../schemas/ai/tools";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { callTool } from "../__test-helpers__/callTool";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../__test-helpers__/otelMock";
import { createReadIssueTool } from "./readIssue";

mockOpenTelemetry();

const makeAdapter = makeTestAkbAdapter;

const SAMPLE_ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Fix the login flow",
  status: "todo",
  priority: "high",
  assigned_to: "alice",
  labels: ["bug", "frontend"],
  depends_on: ["REEF-002"],
  blocks: ["REEF-003"],
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-10T00:00:00.000Z",
  updated_by: "bob",
  source: "user:create_issue",
  external_refs: [{ type: "url", url: "https://example.com/context" }],
  custom_fields: { sensitive_note: "internal-only" },
};

const SAMPLE_BODY = "## Repro\n\n1. open page\n2. observe failure";

function makeDocumentResponse(
  issue: IssueMetadata = SAMPLE_ISSUE,
  body = SAMPLE_BODY,
) {
  const path = `issues/${issue.id.toLowerCase()}.md`;
  return {
    uri: `akb://reef-acme/doc/${path}`,
    vault: "reef-acme",
    path,
    title: `${issue.id} ${issue.title}`,
    type: "task",
    status: "draft",
    summary: issue.title,
    created_by: "alice",
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    current_commit: "abc1234",
    tags: issue.labels ?? [],
    content: body,
    is_public: false,
    public_slug: null,
  };
}

describe("createReadIssueTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls GET /api/v1/documents/{vault}/{id} and returns parsed output", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() },
      { body: makeIssueQueryResponse([SAMPLE_ISSUE]) },
    ]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { id: "REEF-001" });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/documents/reef-acme/issues/reef-001.md",
    );
    expect(result.issue.id).toBe("REEF-001");
    expect(result.issue.title).toBe("Fix the login flow");
    expect(result.issue.status).toBe("todo");
    expect(result.issue.priority).toBe("high");
    expect(result.issue.assigned_to).toBe("alice");
    expect(result.issue.labels).toEqual(["bug", "frontend"]);
    expect(result.issue.depends_on).toEqual(["REEF-002"]);
    expect(result.issue.blocks).toEqual(["REEF-003"]);
    expect(result.content).toContain("Repro");
  });

  it("does not expose detail-only metadata fields to the model", async () => {
    setupFetch([
      { body: makeDocumentResponse() },
      { body: makeIssueQueryResponse([SAMPLE_ISSUE]) },
    ]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { id: "REEF-001" });

    expect(result.issue).not.toHaveProperty("created_by");
    expect(result.issue).not.toHaveProperty("updated_by");
    expect(result.issue).not.toHaveProperty("source");
    expect(result.issue).not.toHaveProperty("external_refs");
    expect(result.issue).not.toHaveProperty("custom_fields");
  });

  it("nulls absent optional fields (priority, assigned_to) in output", async () => {
    const minimalIssue: IssueMetadata = {
      id: "REEF-002",
      title: "Plain issue",
      status: "todo",
      created_at: "2026-05-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: "2026-05-01T00:00:00.000Z",
      updated_by: "alice",
    };
    setupFetch([
      { body: makeDocumentResponse(minimalIssue, "") },
      { body: makeIssueQueryResponse([minimalIssue]) },
    ]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { id: "REEF-002" });

    expect(result.issue.priority).toBeUndefined();
    expect(result.issue.assigned_to).toBeUndefined();
    expect(result.issue.labels).toBeUndefined();
    expect(result.issue.depends_on).toBeUndefined();
    expect(result.issue.blocks).toBeUndefined();
  });

  it("output validates against ReadIssueOutputSchema", async () => {
    setupFetch([
      { body: makeDocumentResponse() },
      { body: makeIssueQueryResponse([SAMPLE_ISSUE]) },
    ]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, { id: "REEF-001" });

    expect(ReadIssueOutputSchema.safeParse(result).success).toBe(true);
  });

  it("propagates NotFoundError when akb returns 404", async () => {
    setupFetch([{ status: 404, body: { detail: "not found" } }]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await expect(callTool(tool, { id: "REEF-999" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("propagates AuthError when akb returns 401", async () => {
    setupFetch([{ status: 401, body: { detail: "invalid token" } }]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await expect(callTool(tool, { id: "REEF-001" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("rejects ids that do not match PREFIX-NUMBER", async () => {
    setupFetch([]); // no fetch should happen
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    // The AI SDK runs the inputSchema before execute; bad ids surface as a
    // Zod validation throw from callTool's execute path. `as does not` bypasses
    // the typed input so we can probe the schema guard.
    await expect(
      callTool(tool, { id: "../etc/passwd" } as never),
    ).rejects.toThrow();
    await expect(callTool(tool, { id: "reef-001" } as never)).rejects.toThrow();
  });

  it("vault is closure-bound — input id cannot smuggle a vault path", async () => {
    const { calls } = setupFetch([
      { body: makeDocumentResponse() },
      { body: makeIssueQueryResponse([SAMPLE_ISSUE]) },
    ]);
    const tool = createReadIssueTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    // Regex rejects anything but PREFIX-NUMBER, so the URL is consistently
    // /documents/reef-acme/{normalized id}. Verify path component.
    await callTool(tool, { id: "REEF-001" });
    expect(calls[0].url).toBe(
      "https://akb.test/api/v1/documents/reef-acme/issues/reef-001.md",
    );
  });
});
