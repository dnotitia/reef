import { describe, expect, it } from "vitest";
import { conversationalPlaybookContent } from "./conversationalPlaybook";

// REEF-136 AC3: the vault-skill drives external agents (Claude Code via akb MCP)
// that also author issues. They honor the workspace authoring language by reading
// it at runtime from reef_settings — the skill is static, the value is not baked
// in (option B). These assertions pin that runtime-read instruction so the
// directive should stay present in the playbook.
describe("conversational playbook — authoring language (REEF-136)", () => {
  const content = conversationalPlaybookContent();

  it("tells the agent to read the authoring_language setting at runtime", () => {
    expect(content).toContain("authoring_language");
    expect(content).toContain("reef_settings");
    expect(content).toMatch(/SELECT value FROM reef_settings WHERE key = /);
  });

  it("specifies the set / unset behavior (configured language, else match existing)", () => {
    expect(content).toContain("## Authoring language");
    // Falls back to existing issues when no default is configured.
    expect(content.toLowerCase()).toContain(
      "match the language of the existing",
    );
  });

  it("keeps symbols untranslated", () => {
    expect(content).toMatch(/keep reef ids|enum values|code identifiers/i);
  });
});

// People fields: requester records who asked for the work (defaulted to the
// acting user on a conversational create, distinct from meta.author), and
// assigned_to is the owner — proposed at create time and reconfirmed when the
// issue is pulled into active work. These pins keep the people-authoring rules
// from silently dropping out of the playbook.
describe("conversational playbook — requester and assignee", () => {
  const content = conversationalPlaybookContent();

  it("defaults requester to the acting user on a conversational create", () => {
    expect(content).toContain("## Requester");
    expect(content).toMatch(/default requester to the acting user/i);
    // Distinct from meta.author (who wrote the row).
    expect(content).toContain("meta.author");
  });

  it("decides assignee at both create time and when work is picked up", () => {
    expect(content).toContain("## Assignee");
    expect(content).toContain("At create time");
    expect(content).toMatch(/pulled into active work/i);
  });

  it("looks up workspace members to propose a person", () => {
    expect(content).toContain("akb_vault_members");
  });
});
