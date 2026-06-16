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
