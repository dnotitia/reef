export const REDACTED = "[redacted]";

const secretStrings = (secrets: readonly string[]): string[] =>
  [...new Set(secrets.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );

function redactString(value: string, secrets: readonly string[]): string {
  return secretStrings(secrets).reduce(
    (redacted, secret) => redacted.split(secret).join(REDACTED),
    value,
  );
}

export function redactUnknown<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") {
    return redactString(value, secrets) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, secrets)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactString(key, secrets),
        redactUnknown(entry, secrets),
      ]),
    ) as T;
  }

  return value;
}

export function safeJsonStringify(
  value: unknown,
  secrets: readonly string[],
  space?: number,
): string {
  return redactString(
    JSON.stringify(redactUnknown(value, secrets), null, space),
    secrets,
  );
}
