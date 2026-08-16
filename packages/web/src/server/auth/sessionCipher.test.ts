// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSessionCipher } from "./sessionCipher";

describe("session token encryption", () => {
  it("round-trips token state without leaving token material in storage", () => {
    const cipher = createSessionCipher(new Uint8Array(Buffer.alloc(32, 3)));
    const tokenSet = {
      accessToken: "access-token-material",
      refreshToken: "refresh-token-material",
      idToken: "id-token-material",
    };

    const sealed = cipher.seal(tokenSet, "session:opaque-handle-hash");

    expect(sealed).not.toContain(tokenSet.accessToken);
    expect(sealed).not.toContain(tokenSet.refreshToken);
    expect(sealed).not.toContain(tokenSet.idToken);
    expect(cipher.open(sealed, "session:opaque-handle-hash")).toEqual(tokenSet);
  });

  it("rejects tampering and cross-record replay with a bounded error", () => {
    const cipher = createSessionCipher(new Uint8Array(Buffer.alloc(32, 3)));
    const sealed = cipher.seal(
      { accessToken: "secret-access-token" },
      "session:first",
    );
    const parts = sealed.split(".");
    parts[2] = `${parts[2]?.startsWith("A") ? "B" : "A"}${parts[2]?.slice(1)}`;
    const tampered = parts.join(".");

    expect(() => cipher.open(tampered, "session:first")).toThrow(
      "sso_session_ciphertext_invalid",
    );
    expect(() => cipher.open(sealed, "session:second")).toThrow(
      "sso_session_ciphertext_invalid",
    );
  });
});
