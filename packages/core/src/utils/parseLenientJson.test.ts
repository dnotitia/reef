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

  it("extracts JSON wrapped in a prose preamble", () => {
    const result = parseLenientJson('Here is the object: {"a":1} thanks');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("does not re-parse the brace slice when input is already pure JSON", () => {
    // White-box check: a body that starts with `{` and ends with `}` should
    // succeed on the FIRST candidate, before the brace-slice candidate is
    // even built. We does not observe the loop directly, but if the slice were
    // pushed and re-parsed it would still succeed — so cover the negative
    // failure path: corrupt the inner JSON so candidate (1) fails AND
    // candidate (3) does not rescue (because there's no different slice).
    const result = parseLenientJson("{not-json}");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for empty input", () => {
    expect(parseLenientJson("").ok).toBe(false);
    expect(parseLenientJson("   ").ok).toBe(false);
  });

  it("returns ok:false for unparseable input with the underlying error", () => {
    const result = parseLenientJson("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Error);
  });
});
