import { describe, expect, it } from "vitest";
import {
  AUTHORING_LANGUAGES,
  AuthoringLanguageSchema,
  authoringLanguagePromptName,
} from "./authoringLanguage";

describe("AuthoringLanguageSchema", () => {
  it("rejects unknown, empty, and non-string values", () => {
    expect(AuthoringLanguageSchema.safeParse("klingon").success).toBe(false);
    expect(AuthoringLanguageSchema.safeParse("").success).toBe(false);
    expect(AuthoringLanguageSchema.safeParse(null).success).toBe(false);
    expect(AuthoringLanguageSchema.safeParse(42).success).toBe(false);
  });

  it("accepts registered codes with nonempty display and prompt names", () => {
    for (const lang of AUTHORING_LANGUAGES) {
      expect(() => AuthoringLanguageSchema.parse(lang.code)).not.toThrow();
      expect(lang.label.length).toBeGreaterThan(0);
      expect(lang.promptName.length).toBeGreaterThan(0);
    }
  });
});

describe("authoringLanguagePromptName", () => {
  it("maps a known code to its English prompt name", () => {
    expect(authoringLanguagePromptName("ko")).toBe("Korean");
    expect(authoringLanguagePromptName("en")).toBe("English");
    expect(authoringLanguagePromptName("ja")).toBe("Japanese");
  });

  it("returns null for unset or unknown codes (degrade to no language forced)", () => {
    expect(authoringLanguagePromptName(null)).toBeNull();
    expect(authoringLanguagePromptName(undefined)).toBeNull();
    expect(authoringLanguagePromptName("")).toBeNull();
    expect(authoringLanguagePromptName("klingon")).toBeNull();
  });
});
