import { describe, expect, it, vi } from "vitest";
import { SuggestPriorityOutputSchema } from "../../../schemas/ai/tools";
import { callTool } from "../__test-helpers__/callTool";
import { suggestPriorityTool } from "./suggestPriority";

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

describe("suggestPriorityTool", () => {
  it("returns 'critical' for outage/production keywords", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "Production outage",
      content: "Site is down",
      repoContext: "",
    });

    expect(result.priority).toBe("critical");
  });

  it("returns 'critical' for security keywords", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "Security breach detected",
      content: "Data loss risk",
      repoContext: "",
    });

    expect(result.priority).toBe("critical");
  });

  it("returns 'high' for performance regression keywords", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "Performance regression",
      content: "Page load 10s",
      repoContext: "",
    });

    expect(result.priority).toBe("high");
  });

  it("returns 'low' for minor typo keywords", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "Minor typo fix",
      content: "Small cosmetic change",
      repoContext: "",
    });

    expect(result.priority).toBe("low");
  });

  it("returns 'medium' for generic task with no signal", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "General task",
      content: "Some work to be done",
      repoContext: "",
    });

    expect(result.priority).toBe("medium");
  });

  it("output validates against SuggestPriorityOutputSchema", async () => {
    const result = await callTool(suggestPriorityTool, {
      title: "Production outage",
      content: "Site is down",
      repoContext: "",
    });

    const parsed = SuggestPriorityOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("returns a rationale string for all priority levels", async () => {
    const cases = [
      {
        title: "Production outage",
        content: "Site is down",
        repoContext: "",
      },
      {
        title: "Performance regression",
        content: "Page load slow",
        repoContext: "",
      },
      {
        title: "Minor typo fix",
        content: "Small cosmetic",
        repoContext: "",
      },
      { title: "General task", content: "Some work", repoContext: "" },
    ];

    for (const input of cases) {
      const result = await callTool(suggestPriorityTool, input);
      expect(typeof result.rationale).toBe("string");
      expect(result.rationale.length).toBeGreaterThan(0);
      const parsed = SuggestPriorityOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    }
  });
});
