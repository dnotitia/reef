// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isDirectIssueMarkdownHref,
  issueIdFromIssueMarkdownHref,
} from "./markdownLinkPolicy";

describe("isDirectIssueMarkdownHref", () => {
  it.each([
    "/workspace/reef-test/issues/REEF-002",
    "#comment-123",
    "akb://reef-test/coll/issues/doc/reef-002.md",
    "akb://reef-test/issues/file/file-1",
  ])("allows the validated direct destination %s", (href) => {
    expect(isDirectIssueMarkdownHref(href)).toBe(true);
  });

  it.each([
    "https://example.com/reef",
    "http://example.com/reef",
    "//example.com/reef",
    "mailto:maintainer@example.com",
    "akb://reef-test/unsupported/value",
  ])("requires confirmation for %s", (href) => {
    expect(isDirectIssueMarkdownHref(href)).toBe(false);
  });
});

describe("issueIdFromIssueMarkdownHref", () => {
  it.each([
    ["/issues/REEF-002", "REEF-002"],
    ["/workspace/reef-test/issues/REEF-002", "REEF-002"],
    ["/workspace/reef-test/issues/TEAM_2-7?view=list", "TEAM_2-7"],
  ])("reads the issue id from %s", (href, issueId) => {
    expect(issueIdFromIssueMarkdownHref(href)).toBe(issueId);
  });

  it.each([
    "https://example.com/issues/REEF-002",
    "/workspace/reef-test/planning/REEF-002",
    "/issues/%E0%A4%A",
  ])("does not classify %s as an issue route", (href) => {
    expect(issueIdFromIssueMarkdownHref(href)).toBeNull();
  });
});
