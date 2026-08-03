// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildMentionRecipients,
  formatMentionToken,
  parseMentionTokens,
  parsePersistedMentionRecipients,
} from "./mention";

describe("comment mention grammar", () => {
  it("uses compact tokens for Unicode letter/number usernames", () => {
    expect(formatMentionToken("alice")).toBe("@alice");
    expect(formatMentionToken("한글42")).toBe("@한글42");
    expect(formatMentionToken("𐐀2")).toBe("@𐐀2");
  });

  it("braces and escapes delimiter-unsafe usernames", () => {
    expect(formatMentionToken("Alice Smith")).toBe("@{Alice Smith}");
    expect(formatMentionToken("team@ops\\blue}")).toBe(
      "@{team@ops\\\\blue\\}}",
    );
  });

  it("parses compact and escaped braced tokens", () => {
    expect(parseMentionTokens("Hi @alice and @{team@ops\\\\blue\\}}.")).toEqual(
      [
        {
          username: "alice",
          raw: "@alice",
          start: 3,
          end: 9,
        },
        {
          username: "team@ops\\blue}",
          raw: "@{team@ops\\\\blue\\}}",
          start: 14,
          end: 33,
        },
      ],
    );
    expect(parseMentionTokens("hello @𐐀2")).toEqual([
      expect.objectContaining({ username: "𐐀2", raw: "@𐐀2" }),
    ]);
  });

  it("excludes email, inline/fenced code, links, and escaped text", () => {
    const body = [
      "mail alice@example.com",
      "code `@alice`",
      "```md",
      "@alice",
      "```",
      "link [@alice](https://example.com/@alice)",
      "escaped \\@alice",
      "real @alice",
    ].join("\n");
    expect(parseMentionTokens(body).map((token) => token.username)).toEqual([
      "alice",
    ]);
  });

  it("deduplicates exact-case roster recipients and rejects unresolved names", () => {
    expect(
      buildMentionRecipients("@alice and @alice and @한글", ["alice", "한글"]),
    ).toEqual(["alice", "한글"]);
    expect(buildMentionRecipients("@Alice", ["alice"])).toEqual([]);
  });

  it("fails closed for a missing or malformed persisted projection", () => {
    expect(parsePersistedMentionRecipients(undefined)).toEqual([]);
    expect(parsePersistedMentionRecipients({ bad: true })).toEqual([]);
    expect(parsePersistedMentionRecipients(["alice", 42])).toEqual([]);
    expect(parsePersistedMentionRecipients(["alice", "alice"])).toEqual([
      "alice",
    ]);
  });
});
