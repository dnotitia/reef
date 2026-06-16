import { describe, expect, it, vi } from "vitest";
import { SuggestLabelsOutputSchema } from "../../../schemas/ai/tools";
import { callTool } from "../__test-helpers__/callTool";
import { suggestLabelsTool } from "./suggestLabels";

// Mock @opentelemetry/api so tracer.startActiveSpan is a passthrough.
type SpanMock = {
  setAttribute: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        async (
          _name: string,
          fn: (span: SpanMock) => Promise<unknown>,
        ): Promise<unknown> => {
          const span: SpanMock = {
            setAttribute: vi.fn(),
            addEvent: vi.fn(),
            recordException: vi.fn(),
            setStatus: vi.fn(),
            end: vi.fn(),
          };
          return fn(span);
        },
      ),
    }),
  },
}));

describe("suggestLabelsTool", () => {
  it("returns 'bug' label for crash/fix keywords", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Fix crash on login",
      content: "App crashes",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("bug");
  });

  it("returns 'enhancement' label for feature keywords", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Add feature X",
      content: "New capability",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("enhancement");
  });

  it("returns 'documentation' label for docs keywords", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Update README",
      content: "Documentation fix",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("documentation");
  });

  it("returns 'refactor' label for refactor keywords", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Refactor auth module",
      content: "cleanup and simplify",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("refactor");
  });

  it("returns 'testing' label for test keywords", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Add vitest coverage",
      content: "Increase test coverage",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("testing");
  });

  it("returns 'needs-triage' fallback for generic title", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Some random task",
      content: "Work to be done",
      repoContext: "",
    });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("needs-triage");
  });

  it("output validates against SuggestLabelsOutputSchema", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Fix crash on login",
      content: "App crashes",
      repoContext: "",
    });

    const parsed = SuggestLabelsOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("each suggestion includes a rationale string", async () => {
    const result = await callTool(suggestLabelsTool, {
      title: "Fix crash on login",
      content: "App crashes",
      repoContext: "",
    });

    for (const suggestion of result.suggestions) {
      expect(typeof suggestion.rationale).toBe("string");
      expect(suggestion.rationale.length).toBeGreaterThan(0);
    }
  });
});
