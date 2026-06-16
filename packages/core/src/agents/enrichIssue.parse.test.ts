import { describe, expect, it } from "vitest";
import { LlmError } from "../errors";
import { parseEnrichmentResponse } from "./enrichIssue";

describe("parseEnrichmentResponse", () => {
  it("parses a plain JSON response", () => {
    const result = parseEnrichmentResponse(
      JSON.stringify({ suggestions: [{ field: "priority", value: "high" }] }),
    );
    expect(result).toEqual([{ field: "priority", value: "high" }]);
  });

  it("strips ```json ... ``` fences", () => {
    const inner = JSON.stringify({ suggestions: [{ x: 1 }] });
    const result = parseEnrichmentResponse(`\`\`\`json\n${inner}\n\`\`\``);
    expect(result).toEqual([{ x: 1 }]);
  });

  it("strips bare ``` fences", () => {
    const inner = JSON.stringify({ suggestions: [] });
    const result = parseEnrichmentResponse(`\`\`\`\n${inner}\n\`\`\``);
    expect(result).toEqual([]);
  });

  it("returns [] when the response is shaped wrong but parses", () => {
    expect(parseEnrichmentResponse(JSON.stringify({}))).toEqual([]);
    expect(
      parseEnrichmentResponse(JSON.stringify({ suggestions: "no" })),
    ).toEqual([]);
  });

  it("throws LlmError on unparseable JSON", () => {
    expect(() => parseEnrichmentResponse("not json")).toThrow(LlmError);
  });

  it("throws LlmError on empty response", () => {
    expect(() => parseEnrichmentResponse("")).toThrow(LlmError);
    expect(() => parseEnrichmentResponse("   ")).toThrow(LlmError);
  });

  it("extracts JSON when the LLM wraps it in prose", () => {
    const inner = JSON.stringify({
      suggestions: [{ field: "priority", value: "high" }],
    });
    const result = parseEnrichmentResponse(
      `Sure! Here is the object you asked for: ${inner} — let me know if you need anything else.`,
    );
    expect(result).toEqual([{ field: "priority", value: "high" }]);
  });
});
