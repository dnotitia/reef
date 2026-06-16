import { describe, expect, it } from "vitest";
import { authoringLanguageDirective } from "./authoringLanguage";
import { buildAutoIssueSystemPrompt } from "./autoIssue";
import { buildEnrichmentSystemPrompt } from "./enrichment";
import { buildStatusRationaleSystemPrompt } from "./statusRationale";

describe("authoringLanguageDirective", () => {
  it("emits a directive naming the configured language", () => {
    const directive = authoringLanguageDirective("ko");
    expect(directive).toContain("WRITING LANGUAGE:");
    expect(directive).toContain("Korean");
    // Symbols should be preserved, not translated.
    expect(directive.toLowerCase()).toContain("code identifiers");
  });

  it("returns an empty string when unset or unknown (no language forced)", () => {
    expect(authoringLanguageDirective(null)).toBe("");
    expect(authoringLanguageDirective(undefined)).toBe("");
    expect(authoringLanguageDirective("")).toBe("");
    expect(authoringLanguageDirective("klingon")).toBe("");
  });
});

// Each content-generating system prompt carries the directive when a language is
// set (AC2) and is byte-for-byte its prior self when unset (AC5).
describe("system prompts honor the authoring language", () => {
  it("buildAutoIssueSystemPrompt appends the directive only when set", () => {
    const withLang = buildAutoIssueSystemPrompt("REEF", "ko");
    const without = buildAutoIssueSystemPrompt("REEF");
    expect(withLang).toContain("WRITING LANGUAGE:");
    expect(withLang).toContain("Korean");
    expect(without).not.toContain("WRITING LANGUAGE:");
    expect(buildAutoIssueSystemPrompt("REEF", null)).toBe(without);
  });

  it("buildEnrichmentSystemPrompt appends the directive only when set", () => {
    const withLang = buildEnrichmentSystemPrompt("ja");
    const without = buildEnrichmentSystemPrompt();
    expect(withLang).toContain("WRITING LANGUAGE:");
    expect(withLang).toContain("Japanese");
    expect(without).not.toContain("WRITING LANGUAGE:");
    expect(buildEnrichmentSystemPrompt(null)).toBe(without);
  });

  it("buildStatusRationaleSystemPrompt appends the directive only when set", () => {
    const withLang = buildStatusRationaleSystemPrompt("es");
    const without = buildStatusRationaleSystemPrompt();
    expect(withLang).toContain("WRITING LANGUAGE:");
    expect(withLang).toContain("Spanish");
    expect(without).not.toContain("WRITING LANGUAGE:");
    expect(buildStatusRationaleSystemPrompt(null)).toBe(without);
  });
});
