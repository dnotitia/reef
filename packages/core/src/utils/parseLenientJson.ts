const FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * Parse a JSON payload that an LLM may have wrapped in noise.
 *
 * Tries up to three candidates in order:
 *   1. The trimmed body as JSON (the clean happy path).
 *   2. The contents of a leading/trailing ```json ... ``` (or bare ```) fence.
 *   3. The substring from the first `{` to the last `}` (covers models that
 *      include a prose preamble like "Sure! Here is the object: { ... }").
 *
 * Candidate (3) is skipped when the trimmed body already starts with `{`
 * and ends with `}` — the slice would be byte-identical to candidate (1),
 * so re-parsing it just doubles the cost on the common clean-JSON path.
 *
 * Returns the parsed value (still `unknown` — caller validates shape).
 * Returns `null` to signal failure; callers translate that into their own
 * domain error so the helper itself stays error-class agnostic.
 */
export function parseLenientJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: new Error("empty input") };

  const fenceMatch = trimmed.match(FENCE_PATTERN);
  const candidates: string[] = [trimmed];
  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (
    firstBrace >= 0 &&
    lastBrace > firstBrace &&
    (firstBrace > 0 || lastBrace < trimmed.length - 1)
  ) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  let lastError: unknown;
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, error: lastError ?? new Error("no candidates") };
}
