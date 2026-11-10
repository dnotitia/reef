import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type AkbAdapter,
  AuthError,
  akbGetMe,
  createAkbAdapter,
  isAkbAccountErrorCode,
} from "@reef/core";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { z } from "zod";
import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";

const SCOPE = "reef:issues:read";
const METADATA = "/.well-known/oauth-protected-resource/mcp";
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const tracer = trace.getTracer("@reef/web");

const statuses = {
  reef_sso_required: 404,
  invalid_origin: 403,
  unauthorized: 401,
  invalid_token: 401,
  insufficient_scope: 403,
  temporarily_unavailable: 503,
} as const;

class McpAuthFailure extends Error {
  constructor(readonly code: keyof typeof statuses) {
    super(code);
  }
}

function deployment() {
  const config = readAuthV2RuntimeConfig();
  const secret = process.env.REEF_MCP_EXCHANGE_CLIENT_SECRET;
  if (!config.enabled || !secret?.trim()) {
    throw new McpAuthFailure("reef_sso_required");
  }
  const resource = `${config.publicOrigin}/mcp`;
  if (resource === config.audience || resource === config.clientId) {
    throw new McpAuthFailure("temporarily_unavailable");
  }
  return {
    issuer: config.issuer,
    oidc: `${config.transportUrl}/protocol/openid-connect`,
    origin: config.publicOrigin,
    resource,
    webClientId: config.clientId,
    akbAudience: config.audience,
    secret,
  };
}

type Deployment = ReturnType<typeof deployment>;

const AccessClaims = z.object({
  typ: z.literal("Bearer"),
  sub: z.string().min(1).max(2_048),
  sid: z.string().min(1).max(2_048),
  azp: z.string().min(1).max(2_048),
  aud: z.union([z.string(), z.tuple([z.string()])]),
  exp: z.int().positive(),
  iat: z.int().positive(),
  scope: z.string().optional(),
});

type ReefSubject = { token: string; sub: string; sid: string; expiry: number };

let realmKeys: { url: string; resolve: ReturnType<typeof createRemoteJWKSet> };

async function verifiedClaims(
  config: Deployment,
  token: string,
  audience: string,
) {
  const url = `${config.oidc}/certs`;
  if (realmKeys?.url !== url) {
    realmKeys = {
      url,
      resolve: createRemoteJWKSet(new URL(url), {
        timeoutDuration: TIMEOUT_MS,
      }),
    };
  }
  const { payload } = await jwtVerify(token, realmKeys.resolve, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience,
    requiredClaims: ["exp", "iat", "sub", "sid", "azp"],
    maxTokenAge: "1 day",
  });
  const claims = AccessClaims.parse(payload);
  const actual = typeof claims.aud === "string" ? claims.aud : claims.aud[0];
  return actual === audience && claims.exp > claims.iat ? claims : null;
}

async function verifySubject(
  config: Deployment,
  token: string,
): Promise<ReefSubject> {
  let claims: Awaited<ReturnType<typeof verifiedClaims>>;
  try {
    claims = await verifiedClaims(config, token, config.resource);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWTExpired ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWKSNoMatchingKey
    ) {
      throw new McpAuthFailure("invalid_token");
    }
    throw new McpAuthFailure("temporarily_unavailable");
  }
  if (
    !claims ||
    claims.azp === config.webClientId ||
    claims.azp === config.resource
  ) {
    throw new McpAuthFailure("invalid_token");
  }
  if (!claims.scope?.split(" ").includes(SCOPE)) {
    throw new McpAuthFailure("insufficient_scope");
  }
  return { token, sub: claims.sub, sid: claims.sid, expiry: claims.exp };
}

const ExchangeResponse = z.object({
  access_token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  issued_token_type: z.literal(TOKEN_TYPE),
  token_type: z.literal("Bearer"),
});
const ExchangeError = z.object({ error: z.string() });

async function exchangeBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new McpAuthFailure("temporarily_unavailable");
  const decoder = new TextDecoder();
  let size = 0;
  let json = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode());
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new McpAuthFailure("temporarily_unavailable");
      }
      json += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function exchangeForAkb(config: Deployment, subject: ReefSubject) {
  return tracer.startActiveSpan("keycloak.mcp.exchange", async (span) => {
    try {
      const response = await fetch(`${config.oidc}/token`, {
        method: "POST",
        body: new URLSearchParams({
          client_id: config.resource,
          client_secret: config.secret,
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: subject.token,
          subject_token_type: TOKEN_TYPE,
          requested_token_type: TOKEN_TYPE,
        }),
        headers: { Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      span.setAttribute("http.response.status_code", response.status);
      const body = await exchangeBody(response);
      if (!response.ok) {
        const failure = ExchangeError.safeParse(body);
        if (
          response.status === 400 &&
          failure.success &&
          ["invalid_grant", "invalid_token"].includes(failure.data.error)
        ) {
          throw new McpAuthFailure("invalid_token");
        }
        throw new McpAuthFailure("temporarily_unavailable");
      }

      const { access_token: token } = ExchangeResponse.parse(body);
      const exchanged = await verifiedClaims(config, token, config.akbAudience);
      if (
        !exchanged ||
        exchanged.azp !== config.resource ||
        exchanged.sub !== subject.sub ||
        exchanged.sid !== subject.sid
      ) {
        throw new McpAuthFailure("temporarily_unavailable");
      }
      return { token, expiry: Math.min(subject.expiry, exchanged.exp) };
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof McpAuthFailure && error.code === "invalid_token") {
        throw error;
      }
      throw new McpAuthFailure("temporarily_unavailable");
    } finally {
      span.end();
    }
  });
}

export async function authenticateMcp(request: Request): Promise<AkbAdapter> {
  const config = deployment();
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== config.origin) {
    throw new McpAuthFailure("invalid_origin");
  }
  const header = request.headers.get("authorization");
  if (header === null) throw new McpAuthFailure("unauthorized");
  const token =
    header.length <= MAX_TOKEN_LENGTH + 7
      ? /^Bearer ([\w.-]+)$/iu.exec(header)?.[1]
      : undefined;
  if (!token) throw new McpAuthFailure("invalid_token");

  const subject = await verifySubject(config, token);
  const exchanged = await exchangeForAkb(config, subject);
  const adapter = createAkbAdapter({
    baseUrl: getAkbBackendUrl(),
    credential: async () => {
      if (Date.now() >= exchanged.expiry * 1_000) {
        throw new AuthError({ origin: "akb", status: 401 });
      }
      return exchanged.token;
    },
  });
  await akbGetMe({ adapter });
  return adapter;
}

export function isResourceDenial(error: unknown): boolean {
  return (
    error instanceof AuthError &&
    error.context.status === 403 &&
    !isAkbAccountErrorCode(error.context.code)
  );
}

function json(body: object, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function mcpAuthError(error: unknown): Response {
  if (isResourceDenial(error)) return json({ error: "access_denied" }, 403);
  const failure =
    error instanceof McpAuthFailure
      ? error.code
      : error instanceof AuthError
        ? "invalid_token"
        : "temporarily_unavailable";
  const accountCode =
    error instanceof AuthError ? error.context.code : undefined;
  const status = statuses[failure];
  const response = json(
    { error: isAkbAccountErrorCode(accountCode) ? accountCode : failure },
    status,
  );
  if (status === 401 || failure === "insufficient_scope") {
    const { origin } = deployment();
    const challenge = [`resource_metadata="${origin}${METADATA}"`];
    if (failure !== "unauthorized") challenge.push(`error="${failure}"`);
    if (failure === "insufficient_scope") challenge.push(`scope="${SCOPE}"`);
    response.headers.set("WWW-Authenticate", `Bearer ${challenge.join(", ")}`);
  }
  return response;
}

export function resourceMetadata(): Response {
  try {
    const { resource, issuer } = deployment();
    return json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    } satisfies OAuthProtectedResourceMetadata);
  } catch (error) {
    return mcpAuthError(error);
  }
}
