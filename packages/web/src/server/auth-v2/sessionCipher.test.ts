// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createAuthV2SessionCipher } from "./sessionCipher";

describe("AES-256-GCM session cipher", () => {
  it("round-trips with key-bound associated data", () => {
    const cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(1));
    const encrypted = cipher.encrypt("secret-refresh-token", "record-key");
    expect(encrypted).not.toContain("secret-refresh-token");
    expect(cipher.decrypt(encrypted, "record-key")).toBe(
      "secret-refresh-token",
    );
    expect(() => cipher.decrypt(encrypted, "other-key")).toThrow();
  });
});
