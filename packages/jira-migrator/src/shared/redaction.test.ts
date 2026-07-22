import { describe, expect, it } from "vitest";
import { REDACTED, redactUnknown, safeJsonStringify } from "./redaction.js";

describe("secret redaction", () => {
  it("redacts secrets from object keys before JSON escaping", () => {
    const secret = 'key-with-"quote';
    const value = { [secret]: { nested: secret } };

    expect(redactUnknown(value, [secret])).toEqual({
      [REDACTED]: { nested: REDACTED },
    });

    const serialized = safeJsonStringify(value, [secret]);
    expect(JSON.parse(serialized)).toEqual({
      [REDACTED]: { nested: REDACTED },
    });
    expect(serialized).not.toContain(secret);
  });
});
