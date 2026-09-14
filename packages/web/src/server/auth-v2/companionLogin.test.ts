// @vitest-environment node
import { createHash, generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCompanionAccountValidator,
  signCompanionLogin,
} from "./companionLogin";
import {
  AccountValidationError,
  type AccountValidationInput,
} from "./oidcValidator";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const env = {
  NODE_ENV: "test",
  REEF_AKB_LOGIN_KEY_ID: "reef-login-v1",
  REEF_AKB_LOGIN_AUDIENCE:
    "https://akb.test/api/v1/auth/sso/companion/complete",
  REEF_AKB_LOGIN_PRIVATE_KEY: privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
};
const proof = {
  nonce: "N".repeat(43),
  idToken: "signed-id",
};
const input: AccountValidationInput = {
  accessToken: "signed-access",
  issuer: "https://idp.test/realms/akb",
  subject: "subject-1",
  providerAlias: "entra",
  loginProof: proof,
};
const user = {
  id: "legacy-april-user",
  username: "alice",
  email: "alice@corp.example",
};
const createValidator = (environment = env) =>
  createCompanionAccountValidator({
    clientId: "reef-web",
    baseUrl: () => "https://akb.test",
    env: environment,
  });

afterEach(() => vi.unstubAllGlobals());

describe("companion login request authentication", () => {
  it("signs the complete proof for the fixed audience and a fresh one-use jti", async () => {
    const request = {
      provider_alias: "entra",
      nonce: proof.nonce,
    };
    const args = {
      clientId: "reef-web",
      request,
      accessToken: input.accessToken,
      idToken: proof.idToken,
      env,
    };
    const first = await signCompanionLogin(args);
    const { payload, protectedHeader } = await jwtVerify(first, publicKey, {
      algorithms: ["RS256"],
      issuer: "reef-web",
      audience: env.REEF_AKB_LOGIN_AUDIENCE,
    });
    expect(protectedHeader).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: "reef-login-v1",
    });
    expect(payload.sub).toBe("reef-web");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);
    expect(payload.request_hash).toBe(
      createHash("sha256")
        .update(
          JSON.stringify([
            "entra",
            proof.nonce,
            input.accessToken,
            proof.idToken,
          ]),
        )
        .digest("base64url"),
    );
    const second = await jwtVerify(await signCompanionLogin(args), publicKey);
    expect(second.payload.jti).not.toBe(payload.jti);
  });
  it.each([
    { REEF_AKB_LOGIN_PRIVATE_KEY: "private-canary-invalid" },
    { REEF_AKB_LOGIN_KEY_ID: "" },
    {
      REEF_AKB_LOGIN_AUDIENCE:
        "https://akb.test/api/v1/auth/sso/companion/complete?token=secret",
    },
    {
      REEF_AKB_LOGIN_AUDIENCE:
        "http://akb.test/api/v1/auth/sso/companion/complete",
    },
  ])(
    "fails closed with a bounded error for invalid configuration",
    async (override) => {
      try {
        await signCompanionLogin({
          clientId: "reef-web",
          request: {
            provider_alias: "entra",
            nonce: proof.nonce,
          },
          accessToken: input.accessToken,
          idToken: proof.idToken,
          env: { ...env, ...override },
        });
        expect.fail("must reject");
      } catch (error) {
        expect(error).toBeInstanceOf(AccountValidationError);
        expect(String(error)).toBe(
          "AccountValidationError: account_validation_unavailable",
        );
      }
    },
  );
});

describe("companion account boundary", () => {
  it("completes once before /me and preserves the original AKB user ID", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer signed-access",
        );
        if (url.endsWith("/complete")) {
          expect(init.method).toBe("POST");
          const headers = new Headers(init.headers);
          expect(headers.get("x-akb-id-token")).toBe(proof.idToken);
          await jwtVerify(
            headers.get("x-akb-login-assertion") ?? "",
            publicKey,
            {
              audience: env.REEF_AKB_LOGIN_AUDIENCE,
            },
          );
          expect(JSON.parse(String(init.body))).toEqual({
            provider_alias: "entra",
            nonce: proof.nonce,
          });
          return Response.json({ user });
        }
        expect(new Headers(init.headers).has("x-akb-login-assertion")).toBe(
          false,
        );
        return Response.json(user);
      }),
    );
    expect(await createValidator()(input)).toEqual({
      outcome: "accepted",
      account: user,
    });
    expect(calls).toEqual([
      env.REEF_AKB_LOGIN_AUDIENCE,
      "https://akb.test/api/v1/auth/me",
    ]);
  });
  it("ordinary account validation does not connect or need a signing key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(user));
    vi.stubGlobal("fetch", fetchMock);
    const { loginProof: _proof, ...ordinary } = input;
    const validator = createCompanionAccountValidator({
      clientId: "reef-web",
      baseUrl: () => "https://akb.test",
      env: {},
    });
    expect(await validator(ordinary)).toEqual({
      outcome: "accepted",
      account: user,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://akb.test/api/v1/auth/me",
    );
  });
  it.each([
    {},
    {
      REEF_AKB_LOGIN_AUDIENCE: "",
      REEF_AKB_LOGIN_KEY_ID: "",
      REEF_AKB_LOGIN_PRIVATE_KEY: "",
    },
  ])(
    "SSO callback needs no completion endpoint or key when enrollment is off",
    async (environment) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(user));
      vi.stubGlobal("fetch", fetchMock);
      const validator = createCompanionAccountValidator({
        clientId: "reef-web",
        baseUrl: () => "https://akb.test",
        env: environment,
      });
      expect(await validator(input)).toEqual({
        outcome: "accepted",
        account: user,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://akb.test/api/v1/auth/me",
      );
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.has("x-akb-login-assertion")).toBe(false);
      expect(headers.has("x-akb-id-token")).toBe(false);
    },
  );
  it.each([
    { REEF_AKB_LOGIN_AUDIENCE: "" },
    { REEF_AKB_LOGIN_KEY_ID: "" },
    { REEF_AKB_LOGIN_PRIVATE_KEY: "" },
    { REEF_AKB_LOGIN_PRIVATE_KEY: "invalid-private-key-canary" },
  ])(
    "configured enrollment fails closed instead of falling back to /me",
    async (override) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(user));
      vi.stubGlobal("fetch", fetchMock);
      expect(await createValidator({ ...env, ...override })(input)).toEqual({
        outcome: "unavailable",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    "membership_required",
    "account_suspended",
    "identity_conflict",
    undefined,
  ])(
    "disabled enrollment never retries /me denial (%s) with completion",
    async (code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            code
              ? { code, detail: { code, message: "denied" } }
              : { detail: "Invalid or expired token" },
            { status: code ? 403 : 401 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const validator = createCompanionAccountValidator({
        clientId: "reef-web",
        baseUrl: () => "https://akb.test",
        env: {},
      });
      expect(await validator(input)).toEqual(
        code ? { outcome: "denied", code } : { outcome: "unavailable" },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://akb.test/api/v1/auth/me",
      );
    },
  );
  it.each(["membership_required", "account_suspended", "identity_conflict"])(
    "preserves account denial %s without /me retries",
    async (code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code, detail: { code, message: "denied" } },
            { status: 403 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      expect(await createValidator()(input)).toEqual({
        outcome: "denied",
        code,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 404, 410, 503])(
    "does not mistake status %s for pending admission",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(Response.json({ message: "upstream" }, { status }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await createValidator()(input)).toEqual({
        outcome: "unavailable",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses a different account from /me after completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user }))
        .mockResolvedValueOnce(Response.json({ ...user, id: "another-user" })),
    );
    expect(await createValidator()(input)).toEqual({ outcome: "unavailable" });
  });
});
