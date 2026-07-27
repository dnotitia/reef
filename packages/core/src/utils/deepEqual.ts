/**
 * Structural equality for Reef's JSON-compatible boundary values.
 *
 * Adapter projections contain primitives, arrays, plain objects, and optional
 * `undefined` properties. Keeping this helper platform-neutral prevents the
 * public core barrel from pulling Node built-ins into browser bundles.
 */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) =>
      Object.hasOwn(rightRecord, key) &&
      deepEqual(leftRecord[key], rightRecord[key]),
  );
}
