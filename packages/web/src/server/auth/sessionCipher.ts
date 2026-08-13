import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SessionCipher {
  seal(value: unknown, recordKey: string): string;
  open<T>(sealed: string, recordKey: string): T;
}

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function createSessionCipher(key: Uint8Array): SessionCipher {
  if (key.byteLength !== 32) {
    throw new Error("sso_session_encryption_key_invalid");
  }
  const keyBytes = Buffer.from(key);
  return {
    seal(value, recordKey) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keyBytes, iv, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(aad(recordKey));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [
        VERSION,
        iv.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
    },
    open<T>(sealed: string, recordKey: string): T {
      try {
        const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
          sealed.split(".");
        if (
          version !== VERSION ||
          !encodedIv ||
          !encodedCiphertext ||
          !encodedTag ||
          extra !== undefined
        ) {
          throw new Error("invalid envelope");
        }
        const iv = Buffer.from(encodedIv, "base64url");
        const tag = Buffer.from(encodedTag, "base64url");
        if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
          throw new Error("invalid envelope");
        }
        const decipher = createDecipheriv(ALGORITHM, keyBytes, iv, {
          authTagLength: TAG_BYTES,
        });
        decipher.setAAD(aad(recordKey));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(encodedCiphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return JSON.parse(plaintext) as T;
      } catch {
        throw new Error("sso_session_ciphertext_invalid");
      }
    },
  };
}

function aad(recordKey: string): Buffer {
  return Buffer.from(`reef-sso-session:${VERSION}:${recordKey}`, "utf8");
}
