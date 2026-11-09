// @vitest-environment node
import { expect, it } from "vitest";
import type { AuthV2EnabledRuntimeConfig } from "@/server/auth-v2/config";
import {
  createPluginOAuthStore,
  opaqueValue,
  PLUGIN_SCOPE,
} from "./oauthStore";

it("shares encrypted records across instances, consumes codes once and enforces deadlines", async () => {
  let time = 1_000;
  const config: AuthV2EnabledRuntimeConfig = {
    enabled: true,
    mode: "sso",
    issuer: "https://identity.test/realms/reef",
    transportUrl: "http://identity.test/realms/reef",
    publicOrigin: "https://reef.test",
    redisUrl: "redis://localhost",
    clientId: "reef-web",
    audience: "reef",
    encryptionKey: new Uint8Array(32),
    sessionNamespace: "plugin-test",
  };
  const records = new Map<string, string>();
  const redis = {
    backend: {
      async get(key: string) {
        return records.get(key) ?? null;
      },
      async set(key: string, value: string) {
        records.set(key, value);
      },
      async consume(key: string) {
        const value = records.get(key);
        records.delete(key);
        return value ?? null;
      },
      async replace() {
        return false;
      },
      async del(key: string) {
        records.delete(key);
      },
    },
    async setBounded() {
      return false;
    },
  };
  const writer = createPluginOAuthStore(config, redis, () => time);
  const reader = createPluginOAuthStore(config, redis, () => time);
  const grant = {
    clientId: opaqueValue(),
    session: { handle: opaqueValue(), deadline: time + 15 },
    resource: "https://reef.test/mcp",
    scope: PLUGIN_SCOPE,
  } as const;
  const token = (await writer.grants.issue(grant, 15)) ?? "";
  const code = {
    ...grant,
    callback: "http://127.0.0.1:43565/callback/native",
    challenge: opaqueValue(),
  };
  const id = (await writer.codes.issue(code)) ?? "";

  expect(JSON.stringify([...records])).not.toContain(grant.session.handle);
  expect(JSON.stringify([...records])).not.toContain(token);
  await expect(reader.grants.read(token)).resolves.toEqual(grant);
  await expect(
    Promise.all([reader.codes.read(id, true), writer.codes.read(id, true)]),
  ).resolves.toEqual([code, null]);

  time += 15;
  await expect(reader.grants.read(token)).resolves.toBeNull();
});
