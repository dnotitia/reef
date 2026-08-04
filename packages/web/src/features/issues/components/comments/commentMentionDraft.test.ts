// @vitest-environment node

import type { VaultMember } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  commentMentionSuggestions,
  draftFromPersistedComment,
  mentionContextAt,
  selectCommentMention,
  serializeCommentMentionDraft,
  updateCommentMentionDraft,
} from "./commentMentionDraft";

const BOB: VaultMember = {
  username: "Bob Smith",
  display_name: "Bob Smith",
  role: "member",
};

describe("comment mention draft", () => {
  it("hides canonical syntax while retaining the persisted identity", () => {
    const draft = draftFromPersistedComment(
      "Hi @{Bob Smith} and @alice",
      new Set(["Bob Smith", "alice"]),
    );

    expect(draft.text).toBe("Hi @Bob Smith and @alice");
    expect(serializeCommentMentionDraft(draft)).toBe(
      "Hi @{Bob Smith} and @alice",
    );
    expect(draft.tokens).toEqual([
      expect.objectContaining({ username: "Bob Smith", start: 3, end: 13 }),
      expect.objectContaining({ username: "alice", resolved: true }),
    ]);
  });

  it("preserves unresolved raw tokens only until their label is edited", () => {
    const draft = draftFromPersistedComment("Hi @{Unknown Person}", new Set());
    expect(draft.text).toBe("Hi @Unknown Person");
    expect(serializeCommentMentionDraft(draft)).toBe("Hi @{Unknown Person}");

    const edited = updateCommentMentionDraft(draft, "Hi @Known Person");
    expect(edited.tokens).toHaveLength(0);
    expect(serializeCommentMentionDraft(edited)).toBe("Hi \\@Known Person");
  });

  it("invalidates an identity when a user changes the visible label", () => {
    const selected = selectCommentMention(
      { text: "say @B", tokens: [] },
      BOB,
      4,
      6,
    );
    expect(selected.text).toBe("say @Bob Smith ");
    expect(serializeCommentMentionDraft(selected)).toBe("say @{Bob Smith} ");

    const changed = updateCommentMentionDraft(selected, "say @Rob Smith ");
    expect(changed.tokens).toHaveLength(0);
    expect(serializeCommentMentionDraft(changed)).toBe("say \\@Rob Smith ");
  });

  it("escapes unresolved ordinary labels and round-trips persisted escapes", () => {
    const typed = { text: "@Nobody", tokens: [] };
    expect(serializeCommentMentionDraft(typed)).toBe("\\@Nobody");

    const persisted = draftFromPersistedComment(
      "Hello \\@Bob Smyth hello and \\@Nobody",
      new Set(),
    );
    expect(persisted.text).toBe("Hello @Bob Smyth hello and @Nobody");
    expect(serializeCommentMentionDraft(persisted)).toBe(
      "Hello \\@Bob Smyth hello and \\@Nobody",
    );
  });

  it("keeps email, code, link, and escaped text boundaries unchanged", () => {
    const body = [
      "mail alice@example.com",
      "inline `@code`",
      "```md",
      "@fenced",
      "```",
      "link [@link](https://example.com/@link)",
      "escaped \\@Nobody",
    ].join("\n");
    const draft = draftFromPersistedComment(body, new Set());

    expect(draft.text).toBe(body.replace("\\@Nobody", "@Nobody"));
    expect(serializeCommentMentionDraft(draft)).toBe(body);
  });

  it("rebases identities across edits outside the label", () => {
    const draft = draftFromPersistedComment(
      "@{Bob Smith}",
      new Set(["Bob Smith"]),
    );
    const updated = updateCommentMentionDraft(draft, "Say @Bob Smith");
    expect(updated.text).toBe("Say @Bob Smith");
    expect(updated.tokens[0]).toMatchObject({ start: 4, end: 14 });
    expect(serializeCommentMentionDraft(updated)).toBe("Say @{Bob Smith}");
  });

  it("keeps a selected identity when attachment Markdown is appended", () => {
    const selected = selectCommentMention({ text: "", tokens: [] }, BOB, 0, 0);
    const updated = updateCommentMentionDraft(
      selected,
      `${selected.text}![screen](akb://reef-test/issues/file/file-1)`,
    );

    expect(serializeCommentMentionDraft(updated)).toBe(
      "@{Bob Smith} ![screen](akb://reef-test/issues/file/file-1)",
    );
  });

  it("keeps autocomplete visible and exact-case", () => {
    expect(mentionContextAt("@B", 2)).toEqual({ start: 0, query: "B" });
    expect(mentionContextAt("mail bob@example.com", 19)).toBeNull();
    expect(
      commentMentionSuggestions(
        [BOB, { username: "bob", display_name: "Bob", role: "member" }],
        { start: 0, query: "b" },
      ).map((member) => member.username),
    ).toEqual(["Bob Smith", "bob"]);
  });
});
