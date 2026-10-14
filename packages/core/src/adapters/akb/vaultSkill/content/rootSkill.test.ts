import { describe, expect, it } from "vitest";
import { rootSkillContent } from "./rootSkill";

// REEF-136 AC3: prose-generating vault-skill paths should honor the workspace
// authoring language. The directive lives in the loaded root skill so every
// retained generated-prose path sees the same setting.
describe("root skill — authoring language (REEF-136)", () => {
  const content = rootSkillContent("reef-test");
  const authoringDirective =
    content
      .split("\n")
      .find((line) =>
        line.startsWith("- Honor the workspace authoring language"),
      ) ?? "";

  it("carries the runtime authoring_language read in the always-loaded skill", () => {
    expect(authoringDirective).toContain("authoring_language");
    expect(authoringDirective).toContain(
      "SELECT value FROM reef_settings WHERE key = 'authoring_language'",
    );
    expect(authoringDirective).toContain("generated prose");
  });

  it("keeps symbols untranslated and the user's words intact", () => {
    expect(authoringDirective).toContain("Translate prose only");
    expect(authoringDirective).toContain("keep reef ids");
    expect(authoringDirective).toContain("enum values");
    expect(authoringDirective).toContain("labels");
    expect(authoringDirective).toContain("code identifiers");
    expect(authoringDirective).toContain("URLs as-is");
    expect(authoringDirective).toContain(
      "never translate the user's own words",
    );
  });
});

// REEF-252: the root skill exposes the activity-history and comment
// paths so an agent asked "show the history" or "add a comment" is routed to the
// comments-and-activity runbook instead of improvising.
describe("root skill — history and comment routing (REEF-252)", () => {
  const content = rootSkillContent("reef-test");

  it("links the comments-and-activity runbook in the runbook list", () => {
    expect(content).toContain(
      "akb://reef-test/doc/reef/runbooks/comments-and-activity.md",
    );
  });

  it("routes an issue-history request to the comments-and-activity runbook", () => {
    expect(content).toMatch(
      /Read an issue's history[\s\S]*comments-and-activity\.md[\s\S]*reef_activity/,
    );
  });

  it("routes a comment request to the comments-and-activity runbook", () => {
    expect(content).toMatch(
      /Read or write comments[\s\S]*comments-and-activity\.md[\s\S]*reef_comments/,
    );
  });
});

// REEF-395: generated issue bodies should use portable Markdown link syntax,
// while Reef issue relationships stay in structured fields instead of prose.
describe("root skill — issue body links (REEF-395)", () => {
  const content = rootSkillContent("reef-test");

  it("puts the issue-body link rule in the always-loaded invariants", () => {
    expect(content).toContain("Issue body links use Markdown");
    expect(content).toContain("[label](https://...)");
    expect(content).toContain("Mention Reef issues as plain ids");
  });

  it("separates prose links from structured issue relationships", () => {
    expect(content).toContain("depends_on");
    expect(content).toContain("related_to");
    expect(content).toContain("parent_id");
    expect(content).toContain("Do not hand-write wiki links");
  });
});

describe("root skill — issue-body mention invariant", () => {
  const content = rootSkillContent("reef-test");

  it("keeps roster resolution and storage boundaries in the always-loaded skill", () => {
    expect(content).toContain(
      "Issue-body mentions are roster-resolved metadata",
    );
    expect(content).toContain("meta.mention_recipients");
    expect(content).toContain(
      "Never add a mention table, column, or separate store",
    );
  });
});
