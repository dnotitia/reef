import { readRequestBody } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ClientId, OPAQUE, PLUGIN_SCOPE } from "./oauthStore";

export const RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp";
export const REGISTER = "/oauth/register";
export const AUTHORIZE = "/oauth/authorize";
export const CONSENT = "/oauth/consent";
export const TOKEN = "/oauth/token";

const OAUTH_BODY_LIMIT = 8_192;

export function loopbackCallback(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.href === value &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
    url.port !== "" &&
    !url.username &&
    !url.password &&
    /^\/callback\/[A-Za-z0-9_-]{1,128}$/u.test(url.pathname) &&
    url.href === url.origin + url.pathname
  );
}

const Callback = z.string().max(256).refine(loopbackCallback);
const Scope = z.literal(PLUGIN_SCOPE);
export const RegistrationInput = z.strictObject({
  client_name: z.string().min(1).max(128).optional(),
  redirect_uris: z.tuple([Callback]),
  grant_types: z.union([
    z.tuple([z.literal("authorization_code")]),
    z.tuple([z.literal("authorization_code"), z.literal("refresh_token")]),
    z.tuple([z.literal("refresh_token"), z.literal("authorization_code")]),
  ]),
  response_types: z.tuple([z.literal("code")]),
  token_endpoint_auth_method: z.literal("none"),
  application_type: z.literal("native"),
  scope: Scope.optional(),
});

export const AuthorizationInput = z.strictObject({
  client_id: ClientId,
  redirect_uri: Callback,
  resource: z.string().max(2_048),
  response_type: z.literal("code"),
  state: z.string().regex(/^[ -~]{1,512}$/u),
  code_challenge: OPAQUE,
  code_challenge_method: z.literal("S256"),
  scope: Scope.default(PLUGIN_SCOPE),
});

export const ConsentInput = z.strictObject({
  transaction: OPAQUE,
  action: OPAQUE,
  decision: z.enum(["approve", "deny"]),
});

export const TokenInput = z.strictObject({
  client_id: ClientId,
  redirect_uri: Callback,
  resource: z.string().max(2_048),
  grant_type: z.literal("authorization_code"),
  code: OPAQUE,
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
});

export function uniqueParams(params: URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  for (const [name, value] of params) {
    if (Object.hasOwn(fields, name)) throw new OAuthFailure("invalid_request");
    fields[name] = value;
  }
  return fields;
}

export async function requestBody(
  request: Request,
  contentType: "application/json" | "application/x-www-form-urlencoded",
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    contentType
  ) {
    throw new OAuthFailure("invalid_request", 415);
  }
  const body = await readRequestBody(request, OAUTH_BODY_LIMIT);
  if (body.tooLarge) throw new OAuthFailure("invalid_request", 413);
  if (contentType === "application/x-www-form-urlencoded") {
    return uniqueParams(new URLSearchParams(body.text));
  }
  try {
    return JSON.parse(body.text);
  } catch {
    throw new OAuthFailure("invalid_request");
  }
}

export const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export class OAuthFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

export function oauthJson(body: object, status = 200): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}
