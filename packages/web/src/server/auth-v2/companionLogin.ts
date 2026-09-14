import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import {
  AKB_COMPANION_LOGIN_PATH,
  AkbUserSchema,
  AuthError,
  akbCompleteCompanionLogin,
  akbGetMe,
  createAkbAdapter,
  isAkbAccountErrorCode,
  type AkbCompanionLoginRequest,
  type AkbUser,
} from "@reef/core";
import type { AuthV2Environment } from "./config";
import { AccountValidationError, type AccountValidator } from "./oidcValidator";

/** No credential/key parser errors can escape into callback diagnostics. */
export function signCompanionLogin(input: {
  clientId: string;
  request: AkbCompanionLoginRequest;
  accessToken: string;
  idToken: string;
  env?: AuthV2Environment;
  now?: number;
}): Promise<string> {
  try {
    const env = input.env ?? process.env;
    const kid = env.REEF_AKB_LOGIN_KEY_ID;
    const pem = env.REEF_AKB_LOGIN_PRIVATE_KEY;
    const audience = env.REEF_AKB_LOGIN_AUDIENCE;
    if (!kid || !/^[A-Za-z0-9_-]{1,128}$/u.test(kid) || !pem || !audience) {
      throw new Error("configuration");
    }
    const url = new URL(audience);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      url.hostname,
    );
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== AKB_COMPANION_LOGIN_PATH ||
      audience !== `${url.origin}${AKB_COMPANION_LOGIN_PATH}` ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          isLoopback &&
          (env.NODE_ENV === "test" || env.NODE_ENV === "development")
        ))
    )
      throw new Error("configuration");
    const key = createPrivateKey(pem);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error("configuration");
    }
    const now = input.now ?? Math.floor(Date.now() / 1000);
    // Array serialization is the versioned cross-language wire contract.
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify([
          input.request.provider_alias,
          input.request.nonce,
          input.accessToken,
          input.idToken,
        ]),
        "utf8",
      )
      .digest("base64url");
    return new SignJWT({ request_hash: requestHash })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
      .setIssuer(input.clientId)
      .setSubject(input.clientId)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti(randomUUID())
      .sign(key)
      .catch(() => {
        throw new AccountValidationError(
          "account_validation_unavailable",
          "unavailable",
        );
      });
  } catch {
    throw new AccountValidationError(
      "account_validation_unavailable",
      "unavailable",
    );
  }
}

/** Completion requires callback proof; refresh/ordinary account checks only use /me. */
export function createCompanionAccountValidator(params: {
  clientId: string;
  baseUrl: () => string;
  env?: AuthV2Environment;
}): AccountValidator<AkbUser> {
  return async (input) => {
    try {
      const adapter = createAkbAdapter({
        baseUrl: params.baseUrl(),
        credential: input.accessToken,
      });
      let completedUser: AkbUser | undefined;
      if (input.loginProof) {
        const request: AkbCompanionLoginRequest = {
          provider_alias: input.providerAlias,
          nonce: input.loginProof.nonce,
        };
        const assertion = await signCompanionLogin({
          clientId: params.clientId,
          request,
          accessToken: input.accessToken,
          idToken: input.loginProof.idToken,
          env: params.env,
        });
        const completed = await akbCompleteCompanionLogin({
          adapter,
          request,
          assertion,
          idToken: input.loginProof.idToken,
        });
        completedUser = completed.user;
      }
      const { profile } = await akbGetMe({ adapter });
      const parsed = AkbUserSchema.safeParse({
        id: profile.user_id ?? profile.id ?? profile.sub,
        username: profile.username,
        email: profile.email,
        display_name: profile.display_name,
        is_admin: profile.is_admin,
      });
      if (
        !parsed.success ||
        (completedUser && completedUser.id !== parsed.data.id)
      ) {
        return { outcome: "unavailable" };
      }
      return { outcome: "accepted", account: parsed.data };
    } catch (error) {
      if (
        error instanceof AuthError &&
        isAkbAccountErrorCode(error.context.code)
      ) {
        return { outcome: "denied", code: error.context.code };
      }
      return { outcome: "unavailable" };
    }
  };
}
