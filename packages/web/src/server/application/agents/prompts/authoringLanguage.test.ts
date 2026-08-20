import { describe, expect, it } from "vitest";
import { authoringLanguageDirective } from "./authoringLanguage";
import { buildEnrichmentSystemPrompt } from "./enrichment";

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

// Each retained content-generating system prompt carries the directive when a
// language is set and is byte-for-byte its prior self when unset.
describe("system prompts honor the authoring language", () => {
  it("buildEnrichmentSystemPrompt appends the directive only when set", () => {
    const withLang = buildEnrichmentSystemPrompt("ja");
    const without = buildEnrichmentSystemPrompt();
    expect(withLang).toContain("WRITING LANGUAGE:");
    expect(withLang).toContain("Japanese");
    expect(without).not.toContain("WRITING LANGUAGE:");
    expect(buildEnrichmentSystemPrompt(null)).toBe(without);
  });
});
