/**
 * Flatten an error chain into a single diagnostic line.
 *
 * Designed for LLM/HTTP error chains where the failure that matters is buried
 * under generic retry/wrapper messages (e.g. AI SDK's `RetryError` wraps each
 * attempt in `errors[]` plus convenience `lastError`; the inner `APICallError`
 * carries `statusCode`, `responseBody`, `url`). We duck-type those fields so
 * the helper stays resilient across AI SDK error-shape changes without
 * coupling to the class.
 *
 * For every error in the chain we also enumerate own scalar keys (including
 * non-enumerable ones) so unexpected error shapes still surface enough
 * detail for diagnosis. Visited set + depth cap guard against cycles and
 * pathological deep chains.
 */
export function extractErrorDetail(err: unknown): string {
  if (err == null) return "Unknown error";
  const parts: string[] = [];
  const visited = new Set<unknown>();

  function pushScalarKeys(label: string, obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (
        key === "name" ||
        key === "stack" ||
        key === "message" ||
        key === "errors" ||
        key === "lastError" ||
        key === "cause"
      ) {
        continue;
      }
      const v = (obj as Record<string, unknown>)[key];
      if (v == null) continue;
      if (typeof v === "string") {
        if (!v) continue;
        const trimmed = v.length > 200 ? `${v.slice(0, 200)}…` : v;
        parts.push(`${label}.${key}=${trimmed}`);
      } else if (typeof v === "number" || typeof v === "boolean") {
        parts.push(`${label}.${key}=${v}`);
      }
    }
  }

  function visit(label: string, node: unknown, depth: number) {
    if (node == null || depth > 4 || visited.has(node)) return;
    visited.add(node);
    if (node instanceof Error) {
      parts.push(`${label}=${node.name}: ${node.message}`);
    } else {
      parts.push(`${label}=${String(node)}`);
    }
    pushScalarKeys(label, node);
    const errors = (node as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      errors.forEach((e, i) => visit(`${label}.errors[${i}]`, e, depth + 1));
    }
    visit(
      `${label}.lastError`,
      (node as { lastError?: unknown }).lastError,
      depth + 1,
    );
    visit(`${label}.cause`, (node as { cause?: unknown }).cause, depth + 1);
  }

  visit("err", err, 0);
  return parts.join(" | ");
}
