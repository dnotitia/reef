function extractFencedCandidate(trimmed: string): string | undefined {
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return undefined;
  }

  const contentStart = trimmed.slice(3, 7).toLowerCase() === "json" ? 7 : 3;
  return trimmed.slice(contentStart, -3).trim();
}

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
 * Returns the parsed value (still `unknown` — caller validates shape), or an
 * `ok: false` result so callers can translate failure into a domain error.
 */
export function parseLenientJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: new Error("empty input") };

  const fencedCandidate = extractFencedCandidate(trimmed);
  const candidates: string[] = [trimmed];
  if (fencedCandidate !== undefined) candidates.push(fencedCandidate);
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
