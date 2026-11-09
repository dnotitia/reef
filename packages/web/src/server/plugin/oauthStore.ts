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
const CLIENT_TTL = 86_400;

export function opaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

const ClientRegistration = z.object({ callback: z.string() });
const AuthorizationBinding = z.object({
  clientId: OPAQUE,
  callback: z.string(),
  resource: z.string(),
  scope: z.literal(PLUGIN_SCOPE),
  challenge: OPAQUE,
});
const PendingConsent = AuthorizationBinding.extend({
  state: z.string(),
  browserDigest: OPAQUE,
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
  { backend, setBounded }: Pick<AuthV2ProcessRedis, "backend" | "setBounded">,
  now: () => number,
) {
  const cipher = createAuthV2SessionCipher(config.encryptionKey);
  const prefix = `${config.sessionNamespace}:reef:plugin:`;
  function records<T>(
    kind: string,
    schema: z.ZodType<T>,
    ttl: number,
    cap?: number,
  ) {
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
        if (cap === undefined) {
          await backend.set(key, data, expiresIn);
        } else if (
          !(await setBounded({
            key,
            data,
            expiresIn,
            index: `${prefix}quota:${kind}`,
            cap,
          }))
        ) {
          return null;
        }
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
    clients: records("client", ClientRegistration, CLIENT_TTL, 10_000),
    pending: records("pending", PendingConsent, PENDING_TTL, 1_000),
    codes: records("code", AuthorizationCode, CODE_TTL),
    grants: records("grant", PluginGrant, GRANT_TTL),
  };
}
