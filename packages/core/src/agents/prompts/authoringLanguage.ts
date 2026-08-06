import { authoringLanguagePromptName } from "../../schemas/workspace/authoringLanguage";

/**
 * Build the system-prompt directive that pins AI-generated prose to the
 * workspace's configured authoring language (REEF-136).
 *
 * Returns an empty string when no language is set (or the stored code is
 * unknown), so a generation prompt with no configured language is byte-for-byte
 * its prior self — preserving the existing "no language forced" behavior. When a
 * language IS set, the directive instructs the model to write generated prose in
 * that language while leaving symbols (code identifiers, issue IDs, enum values,
 * URLs, field keys) untouched.
 *
 * Appended to the END of the system prompt by each content-generating builder so
 * it is the last, most salient instruction the model reads.
 */
export function authoringLanguageDirective(
  language: string | null | undefined,
): string {
  const name = authoringLanguagePromptName(language);
  if (!name) return "";
  return `\n\nWRITING LANGUAGE:\nWrite all generated natural-language prose (the issue title, the body content, any rationale) in ${name}. This is the workspace's default authoring language. Translate prose only — keep code identifiers, issue IDs, enum values (e.g. status/priority), URLs, and JSON field keys exactly as specified above.`;
}
