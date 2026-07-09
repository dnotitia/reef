import { describe, expect, it } from "vitest";
import { rootSkillContent } from "./rootSkill";

// REEF-136 AC3: prose-generating vault-skill paths should honor the workspace
// authoring language. The conversational-create path and the GitHub
// activity-scan path both author prose (titles, bodies, rationales), so the
// directive lives in the loaded root skill — not just in the
// conversational playbook — so a scan agent that does not open the playbook still
// gets it. These assertions pin that placement.
describe("root skill — authoring language (REEF-136)", () => {
  const content = rootSkillContent("reef-test");

  it("carries the runtime authoring_language read in the always-loaded skill", () => {
    expect(content).toContain("authoring_language");
    expect(content).toContain(
      "SELECT value FROM reef_settings WHERE key = 'authoring_language'",
    );
  });

  it("covers both conversation and code-activity scan prose", () => {
    expect(content.toLowerCase()).toContain("code-activity scan");
    expect(content.toLowerCase()).toContain("status-change rationale");
  });

  it("keeps symbols untranslated and the user's words intact", () => {
    expect(content).toMatch(/keep reef ids|enum values|code identifiers/i);
    expect(content.toLowerCase()).toContain(
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
      "akb://reef-test/doc/overview/reef/comments-and-activity.md",
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
