import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthV2EnabledRuntimeConfig } from "@/server/auth-v2/config";
import { createAuthV2SessionCipher } from "@/server/auth-v2/sessionCipher";
import { AuthorizationBinding, PENDING_TTL, opaqueValue } from "./oauthStore";

const CLIENT_TTL = 86_400;
const Pending = AuthorizationBinding.omit({ resource: true }).extend({
  state: z.string(),
  expiresAt: z.number().int(),
});

export const nowSeconds = () => Math.floor(Date.now() / 1_000);

export function createOAuthBrowserState(config: AuthV2EnabledRuntimeConfig) {
  const cipher = createAuthV2SessionCipher(config.encryptionKey);
  const context = `${config.sessionNamespace}:reef:plugin:${config.publicOrigin}/mcp`;

  function signClient(callback: string, expiresAt: number) {
    return createHmac("sha256", config.encryptionKey)
      .update(JSON.stringify([context, "client", callback, expiresAt]))
      .digest("base64url");
  }

  function isRegistered(clientId: string, callback: string) {
    const [expiry, signature] = clientId.split(".");
    const expiresAt = Number(expiry);
    return (
      expiresAt > nowSeconds() &&
      signature !== undefined &&
      equalOpaque(signClient(callback, expiresAt), signature)
    );
  }

  return {
    register(callback: string) {
      const expiresAt = nowSeconds() + CLIENT_TTL;
      return `${expiresAt}.${signClient(callback, expiresAt)}`;
    },
    isRegistered,
    issueConsent(binding: Omit<z.infer<typeof Pending>, "expiresAt">) {
      const transaction = opaqueValue();
      const sealed = cipher.encrypt(
        JSON.stringify({ ...binding, expiresAt: nowSeconds() + PENDING_TTL }),
        `${context}:consent:${transaction}`,
      );
      return { transaction, sealed };
    },
    readConsent(transaction: string, sealed: string) {
      if (
        sealed.length > 3_000 ||
        !/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u.test(sealed)
      )
        return null;
      try {
        const pending = Pending.parse(
          JSON.parse(
            cipher.decrypt(sealed, `${context}:consent:${transaction}`),
          ),
        );
        return pending.expiresAt > nowSeconds() &&
          isRegistered(pending.clientId, pending.callback)
          ? pending
          : null;
      } catch {
        return null;
      }
    },
  };
}

export function equalOpaque(expected: string, value: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(value);
  return left.length === right.length && timingSafeEqual(left, right);
}
