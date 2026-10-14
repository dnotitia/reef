import { describe, expect, it } from "vitest";
import { parseLenientJson } from "./parseLenientJson";

describe("parseLenientJson", () => {
  it("parses clean JSON", () => {
    const result = parseLenientJson('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("strips a ```json ... ``` fence", () => {
    const result = parseLenientJson('```json\n{"a":1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("strips a bare ``` fence", () => {
    const result = parseLenientJson('```\n{"a":1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("strips a case-insensitive JSON fence without a backtracking regex", () => {
    const result = parseLenientJson('```JSON\n{"a":1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("rejects an unterminated fence with a long whitespace run", () => {
    const result = parseLenientJson(`\`\`\`json\n${" ".repeat(100_000)}x`);
    expect(result.ok).toBe(false);
  });

  it("extracts JSON wrapped in a prose preamble", () => {
    const result = parseLenientJson('Here is the object: {"a":1} thanks');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("returns ok:false for empty input", () => {
    expect(parseLenientJson("").ok).toBe(false);
    expect(parseLenientJson("   ").ok).toBe(false);
  });

  it.each(["not json at all", "{not-json}"])(
    "returns ok:false for unparseable input %s with the underlying error",
    (input) => {
      const result = parseLenientJson(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(Error);
    },
  );
});
