import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AuthV2ProcessRedis } from "@/server/auth-v2/redisRuntime";
import { createAuthV2SessionCipher } from "@/server/auth-v2/sessionCipher";
import type { AuthV2EnabledRuntimeConfig } from "@/server/auth-v2/config";

export const PLUGIN_SCOPE = "reef:issues:read";
export const OPAQUE = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const PENDING_TTL = 300;
export const GRANT_TTL = 3_600;
const CODE_TTL = 60;
export const ClientId = z.string().regex(/^\d{1,12}\.[A-Za-z0-9_-]{43}$/u);

export function opaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export const AuthorizationBinding = z.object({
  clientId: ClientId,
  callback: z.string(),
  resource: z.string(),
  scope: z.literal(PLUGIN_SCOPE),
  challenge: OPAQUE,
});
const SessionReference = z.object({
  handle: OPAQUE,
  deadline: z.number().int(),
});
const AuthorizationCode = AuthorizationBinding.extend({
  session: SessionReference,
});
const PluginGrant = AuthorizationCode.pick({
  clientId: true,
  resource: true,
  scope: true,
  session: true,
});

export function createPluginOAuthStore(
  config: AuthV2EnabledRuntimeConfig,
  { backend, claim }: Pick<AuthV2ProcessRedis, "backend" | "claim">,
  now: () => number,
) {
  const cipher = createAuthV2SessionCipher(config.encryptionKey);
  const prefix = `${config.sessionNamespace}:reef:plugin:`;
  function records<T>(kind: string, schema: z.ZodType<T>, ttl: number) {
    const keyFor = (id: string) => `${prefix}${kind}:${digest(id)}`;
    return {
      async issue(value: T, lifetime = ttl) {
        const id = opaqueValue();
        const key = keyFor(id);
        const expiresIn = Math.min(ttl, lifetime);
        const data = cipher.encrypt(
          JSON.stringify({ value, expiresAt: now() + expiresIn }),
          key,
        );
        await backend.set(key, data, expiresIn);
        return id;
      },
      async read(id: string, consume = false): Promise<T | null> {
        if (!OPAQUE.safeParse(id).success) return null;
        const key = keyFor(id);
        const data = await (consume ? backend.consume(key) : backend.get(key));
        if (!data) return null;
        const record = z
          .object({ value: schema, expiresAt: z.number().int() })
          .parse(JSON.parse(cipher.decrypt(data, key)));
        return record.expiresAt > now() ? record.value : null;
      },
    };
  }

  return {
    async claimConsent(transaction: string, expiresAt: number) {
      const ttl = expiresAt - now();
      return ttl > 0 && claim(`${prefix}consent:${digest(transaction)}`, ttl);
    },
    codes: records("code", AuthorizationCode, CODE_TTL),
    grants: records("grant", PluginGrant, GRANT_TTL),
  };
}
