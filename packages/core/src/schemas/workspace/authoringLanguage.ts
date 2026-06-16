import { z } from "zod";

/**
 * Workspace default authoring language (REEF-136).
 *
 * A team-shared workspace setting that names the language AI-generated content
 * (issue titles and bodies, status rationales) should be written in, so the
 * whole workspace produces consistent prose regardless of who — or which agent
 * path — created the content. It is a *default*, not a hard constraint, and just
 * affects generated natural-language prose: code identifiers, issue IDs, enum
 * values, and field keys stay as-is.
 *
 * Stored as a stable language code (not free text) in the `reef_settings`
 * key-value table so the value round-trips through the picker, the AI prompt
 * directive, and the vault-skill runtime read without ambiguity. "Unset" is the
 * absence of the row (no language forced) — the schema models a configured value
 * just; callers represent unset as `null`.
 */
const AUTHORING_LANGUAGE_CODES = [
  "en",
  "ko",
  "ja",
  "zh",
  "es",
  "fr",
  "de",
  "pt",
] as const;

export const AuthoringLanguageSchema = z.enum(AUTHORING_LANGUAGE_CODES);
export type AuthoringLanguage = z.infer<typeof AuthoringLanguageSchema>;

export interface AuthoringLanguageOption {
  /** Stable storage code (the persisted value). */
  code: AuthoringLanguage;
  /** Display label for the Settings picker, in the language's own script. */
  label: string;
  /**
   * The English language name injected into the AI prompt directive. Kept in
   * English (not the native label) because the directive itself is an
   * English-language instruction the model reads ("Write … in Korean").
   */
  promptName: string;
}

/**
 * The languages a workspace can pick as its authoring default. The order here
 * is the order the Settings picker renders. Extend this list to support more
 * languages; the code should also be added to `AUTHORING_LANGUAGE_CODES` above.
 */
export const AUTHORING_LANGUAGES: readonly AuthoringLanguageOption[] = [
  { code: "en", label: "English", promptName: "English" },
  { code: "ko", label: "한국어", promptName: "Korean" },
  { code: "ja", label: "日本語", promptName: "Japanese" },
  { code: "zh", label: "中文", promptName: "Chinese" },
  { code: "es", label: "Español", promptName: "Spanish" },
  { code: "fr", label: "Français", promptName: "French" },
  { code: "de", label: "Deutsch", promptName: "German" },
  { code: "pt", label: "Português", promptName: "Portuguese" },
];

/**
 * Resolve a stored authoring-language code to the English language name used in
 * the AI prompt directive. Returns `null` for an unset value or an unknown code
 * (so a stale/foreign code degrades to "no language forced" rather than emitting
 * a broken directive).
 */
export function authoringLanguagePromptName(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return AUTHORING_LANGUAGES.find((l) => l.code === code)?.promptName ?? null;
}
