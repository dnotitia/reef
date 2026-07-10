import { describe, expect, it } from "vitest";
import { commentsAndActivityContent } from "./commentsAndActivity";

/**
 * Contract regression for the comments-and-activity runbook (REEF-252). The
 * runbook is the agent-facing surface for reading the reef_activity timeline and
 * reading/writing reef_comments. These assertions pin the load-bearing SQL and
 * guards against the real adapters (akb/issues/activity.ts, akb/issues/comments.ts)
 * so the prose stays aligned with the code path an MCP agent reproduces by
 * hand.
 */
describe("comments-and-activity runbook (REEF-252)", () => {
  const content = commentsAndActivityContent();

  describe("activity timeline read", () => {
    it("documents the oldest-first reef_activity query the adapter uses", () => {
      expect(content).toContain(
        "SELECT * FROM reef_activity WHERE reef_id = 'REEF-001' ORDER BY meta->>'at' ASC, id ASC",
      );
    });

    it("explains how to interpret the payload for every event_type", () => {
      for (const eventType of [
        "status_change",
        "assignee_change",
        "priority_change",
        "planning_link",
        "impl_ref_linked",
      ]) {
        expect(content).toContain(eventType);
      }
    });

    it("marks the log append-only — never UPDATE or DELETE an event row", () => {
      expect(content).toContain("Never UPDATE or DELETE a reef_activity row");
    });

    it("notes a missing table reads as an empty history, not a failure", () => {
      expect(content.toLowerCase()).toContain("empty history");
    });
  });

  describe("comment read", () => {
    it("documents the oldest-first reef_comments query the adapter uses", () => {
      expect(content).toContain(
        "SELECT * FROM reef_comments WHERE reef_id = 'REEF-001' ORDER BY meta->>'created_at' ASC, id ASC",
      );
    });

    it("documents root/reply metadata and rejects malformed flattening", () => {
      expect(content).toContain("parent_comment_id");
      expect(content).toContain("thread_root_id");
      expect(content).toContain("Presentation stays one visual depth");
      expect(content).toContain("Never flatten a malformed reply");
    });

    it("projects author and timestamps from meta, not akb's auto columns", () => {
      expect(content).toContain(
        "projected from meta -- NOT from akb's auto created_by/created_at columns",
      );
    });
  });

  describe("comment write", () => {
    it("resolves the author from akb_whoami on the MCP path", () => {
      expect(content).toContain("akb_whoami");
      expect(content).toContain("The comment author is the acting user");
    });

    it("guards issue existence in the same conditional insert", () => {
      expect(content).toContain("WITH target_issue AS");
      expect(content).toContain("FROM target_issue");
      expect(content).toContain("RETURNING *");
    });

    it("inserts body plus the meta author/created_at/edited_at shape", () => {
      expect(content).toContain(
        "INSERT INTO reef_comments (reef_id, body, meta)",
      );
      expect(content).toContain('"author":"ACTOR"');
      expect(content).toContain('"edited_at":null');
      expect(content).toContain('"parent_comment_id":null');
      expect(content).toContain('"thread_root_id":null');
    });

    it("requires a full ISO-8601 created_at, never now()::text", () => {
      expect(content).toContain(
        `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      );
      expect(content).toContain("never write now()::text");
    });

    it("requires escaping the user-controlled body as data (double single quotes)", () => {
      // The body is the most user-controlled free text in the runbook, so the
      // single-quote-doubling rule is stated at the point of use to avoid a
      // broken INSERT or an akb_sql injection path. Mirrors quoteText in
      // adapters/akb/core/sql.ts (value.replace(/'/g, "''")).
      expect(content).toContain("user-controlled free text");
      expect(content).toContain("'it''s blocked'");
    });
  });

  describe("comment reply", () => {
    it("requires atomic parent/root validation and trusted importer mapping", () => {
      expect(content).toContain(
        "Parent/root validation and the INSERT MUST be one conditional statement",
      );
      expect(content).toContain("same parent-not-found error");
      expect(content).toContain("Trusted importers use that same path");
      expect(content).toContain("never let a browser supply thread_root_id");
    });
  });

  describe("comment edit", () => {
    it("enforces author ownership in the WHERE clause", () => {
      expect(content).toContain("meta->>'author' = 'ACTOR'");
    });

    it("sets only edited_at via jsonb_set, preserving author and created_at", () => {
      expect(content).toContain("jsonb_set(meta::jsonb, '{edited_at}'");
      expect(content).toContain("preserving meta.author and meta.created_at");
    });

    it("has no delete-comment flow", () => {
      expect(content).toContain("do not DELETE comment rows");
    });
  });
});
