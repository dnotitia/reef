import { describe, expect, it } from "vitest";
import { mergeJiraCustomFields } from "./objects.js";

describe("mergeJiraCustomFields", () => {
  it("deep-merges rank, account, and planning provenance without input mutation", () => {
    const input = {
      keep: true,
      jira: { rank: { value: "a" }, users: [{ actor: "one" }] },
    };
    const before = JSON.stringify(input);
    const result = mergeJiraCustomFields(
      input,
      { planning: { release: "r-1" } },
      { rank: { mapped: 1000 } },
    );
    expect(result).toEqual({
      keep: true,
      jira: {
        rank: { value: "a", mapped: 1000 },
        users: [{ actor: "one" }],
        planning: { release: "r-1" },
      },
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("ignores prototype-pollution keys", () => {
    const fragment = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    expect(mergeJiraCustomFields({}, fragment)).toEqual({ jira: { safe: 1 } });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
