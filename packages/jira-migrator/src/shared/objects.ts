const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

export const isPlainObject = (
  value: unknown,
): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!unsafeKeys.has(key)) result[key] = cloneValue(child);
  }
  return result;
};

const mergeRecords = (
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const result = cloneValue(left) as Record<string, unknown>;
  for (const [key, value] of Object.entries(right)) {
    if (unsafeKeys.has(key)) continue;
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeRecords(current, value)
        : cloneValue(value);
  }
  return result;
};

/**
 * Immutably deep-merges compact Jira provenance into IssueMetadata custom fields.
 * Arrays are atomic values, preventing account/planning/rank producers from
 * accidentally concatenating duplicate observations.
 */
export const mergeJiraCustomFields = (
  existing: unknown,
  ...jiraFragments: readonly unknown[]
): Record<string, unknown> => {
  const base = isPlainObject(existing) ? existing : {};
  const existingJira = isPlainObject(base.jira) ? base.jira : {};
  const jira = jiraFragments.reduce<Record<string, unknown>>(
    (current, fragment) =>
      isPlainObject(fragment) ? mergeRecords(current, fragment) : current,
    cloneValue(existingJira) as Record<string, unknown>,
  );
  return mergeRecords(base, { jira });
};

export const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
