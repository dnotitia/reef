import { describe, expect, it } from "vitest";
import { issueWorkflowsContent } from "./issueWorkflows";

// REEF-224: the issue-creation runbook let three repeated defects pass through.
// These assertions pin the guardrails so the runbook can no longer guide an
// agent into a malformed or invisible issue.
describe("issue workflows runbook — creation guardrails (REEF-224)", () => {
  const content = issueWorkflowsContent();

  // AC1: the INSERT mechanism should surface parent_id so an epic child is not
  // created all-null, and "Default issue fields" should say how to fill it.
  describe("parent_id exposure (AC1)", () => {
    it("lists parent_id in the INSERT column skeleton", () => {
      expect(content).toMatch(
        /requester,\s*parent_id,\s*labels, depends_on, related_to, blocks, meta/,
      );
    });

    it("shows an epic-child INSERT example that sets parent_id", () => {
      expect(content).toContain("hangs under an epic");
      expect(content).toContain("'ACTOR', 'REEF-012'");
    });

    it("documents reading a sibling's parent_id instead of leaving it NULL", () => {
      expect(content).toContain("SELECT parent_id FROM reef_issues WHERE");
      expect(content).toContain("- parent_id:");
      expect(content).toContain("do not leave a child all-null");
    });
  });

  // AC2: ISO date fields should be written in a parseable format; a "+00" tail
  // without minutes silently drops the row from the board.
  describe("timestamp format guard (AC2)", () => {
    it("requires toISOString form or an offset with minutes", () => {
      expect(content).toContain("2026-06-15T07:34:38.237Z");
      expect(content).toContain("2026-06-15T07:34:38+00:00");
      expect(content).toContain(
        `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      );
    });

    it("warns that a minute-less +00 tail breaks parsing and hides the issue", () => {
      expect(content).toContain('"+00" offset without minutes');
      expect(content).toContain("now()::text");
      expect(content).toContain("silently vanishes from the board");
    });
  });

  // AC3: a present row whose meta fails schema validation is skipped with no
  // error; the runbook should name the failure mode and a diagnostic.
  describe("silent validation-failure warning (AC3)", () => {
    it("names the silent-skip failure mode for malformed meta", () => {
      expect(content).toContain(
        "When the row is present but the board hides it",
      );
      expect(content).toContain("silently skips any row that fails");
      expect(content).toContain("no error is surfaced");
    });

    it("gives a SELECT * comparison diagnostic against a healthy row", () => {
      expect(content).toContain(
        "SELECT * FROM reef_issues WHERE reef_id IN ('REEF-MISSING', 'REEF-VISIBLE')",
      );
    });
  });
});
