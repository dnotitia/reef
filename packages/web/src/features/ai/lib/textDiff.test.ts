// @vitest-environment node

import { describe, expect, it } from "vitest";
import { lineDiff, wordDiff } from "./textDiff";

describe("wordDiff", () => {
  it("keeps shared words equal and marks the rest add/remove", () => {
    const segments = wordDiff(
      "login broken on safari",
      "login flaky on safari",
    );
    expect(segments).toEqual([
      { type: "equal", text: "login" },
      { type: "remove", text: "broken" },
      { type: "add", text: "flaky" },
      { type: "equal", text: "on safari" },
    ]);
  });

  it("treats an empty before as all-add", () => {
    expect(wordDiff("", "brand new title")).toEqual([
      { type: "add", text: "brand new title" },
    ]);
  });

  it("treats an empty after as all-remove", () => {
    expect(wordDiff("old title here", "")).toEqual([
      { type: "remove", text: "old title here" },
    ]);
  });

  it("returns a single equal run for identical input", () => {
    expect(wordDiff("same words", "same words")).toEqual([
      { type: "equal", text: "same words" },
    ]);
  });
});

describe("lineDiff", () => {
  it("diffs by line, merging consecutive same-type lines", () => {
    const before = "line a\nline b\nline c";
    const after = "line a\nline b2\nline c";
    expect(lineDiff(before, after)).toEqual([
      { type: "equal", text: "line a" },
      { type: "remove", text: "line b" },
      { type: "add", text: "line b2" },
      { type: "equal", text: "line c" },
    ]);
  });

  it("marks every line added when before is empty", () => {
    expect(lineDiff("", "## Summary\nDetails")).toEqual([
      { type: "add", text: "## Summary\nDetails" },
    ]);
  });
});
