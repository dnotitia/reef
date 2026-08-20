import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AES_KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class AuthV2SessionCipherError extends Error {
  constructor() {
    super("auth_v2_session_cipher_invalid");
    this.name = "AuthV2SessionCipherError";
  }
}

export interface AuthV2SessionCipher {
  encrypt(plaintext: string, associatedData: string): string;
  decrypt(ciphertext: string, associatedData: string): string;
}

/**
 * AES-256-GCM for the future auth-v2 session envelope.
 *
 * The caller supplies the Redis record key as associated data. A copied
 * ciphertext therefore cannot be moved to another record without failing
 * authentication. The key is never serialised, logged, or returned by this
 * module.
 */
export function createAuthV2SessionCipher(
  key: Uint8Array,
): AuthV2SessionCipher {
  if (key.byteLength !== AES_KEY_BYTES) {
    throw new AuthV2SessionCipherError();
  }
  const secret = Buffer.from(key);

  return {
    encrypt(plaintext, associatedData) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", secret, iv);
      cipher.setAAD(Buffer.from(associatedData, "utf8"));
      const body = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      return [
        "v1",
        iv.toString("base64url"),
        authTag.toString("base64url"),
        body.toString("base64url"),
      ].join(".");
    },

    decrypt(ciphertext, associatedData) {
      const [version, ivValue, tagValue, bodyValue] = ciphertext.split(".");
      if (!version || version !== "v1" || !ivValue || !tagValue || !bodyValue) {
        throw new AuthV2SessionCipherError();
      }
      try {
        const iv = Buffer.from(ivValue, "base64url");
        const authTag = Buffer.from(tagValue, "base64url");
        const body = Buffer.from(bodyValue, "base64url");
        if (
          iv.byteLength !== IV_BYTES ||
          authTag.byteLength !== AUTH_TAG_BYTES ||
          body.byteLength === 0
        ) {
          throw new AuthV2SessionCipherError();
        }
        const decipher = createDecipheriv("aes-256-gcm", secret, iv);
        decipher.setAAD(Buffer.from(associatedData, "utf8"));
        decipher.setAuthTag(authTag);
        return Buffer.concat([
          decipher.update(body),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new AuthV2SessionCipherError();
      }
    },
  };
}
