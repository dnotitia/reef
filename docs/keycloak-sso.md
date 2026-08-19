# Reef Keycloak SSO BFF Contract

Reef has two explicit authentication profiles. `local` preserves AKB's
username/password login and AKB-issued JWT cookie. `sso` makes reef-web the OIDC
Backend-for-Frontend for a dedicated Keycloak client. SSO never calls AKB's
retired Keycloak browser-login or JWT-exchange endpoints and never creates,
stores, returns, or forwards an AKB user JWT.

## Reef environment

Every deployment selects a mode:

```bash
REEF_AUTH_MODE=sso
AKB_BACKEND_URL=https://akb.example.com
REEF_PUBLIC_ORIGIN=https://reef.example.com
REEF_KEYCLOAK_ISSUER=https://identity.example.com/realms/reef
REEF_KEYCLOAK_TRANSPORT_URL=http://keycloak.identity.svc.cluster.local:8080/realms/reef
REEF_KEYCLOAK_CLIENT_ID=reef-web
REEF_AKB_API_AUDIENCE=akb-api
REEF_SESSION_REDIS_URL=rediss://redis.example.com:6380/0
REEF_SESSION_ENCRYPTION_KEY=<base64-encoded-32-byte-random-key>
```

`REEF_PUBLIC_ORIGIN` must be a bare HTTPS origin outside loopback development.
The session key must be generated independently from Keycloak, AKB, Redis, and
other application secrets; `openssl rand -base64 32` produces the required
size. Keep both the Redis URL and encryption key in the deployment secret
store. Do not expose any SSO setting through `NEXT_PUBLIC_*`.

Production SSO fails at startup when Redis, the encryption key, or the internal
Keycloak transport is absent or invalid. The transport URL must use a non-IP
in-cluster DNS name, contain no credentials/query/fragment, use the exact realm
path from `REEF_KEYCLOAK_ISSUER`, and be distinct from the public issuer host.
Tests and non-production development may omit it and use the canonical issuer
for transport; they may also omit Redis and the encryption key and use an
in-memory store with a process-ephemeral key. That fallback is intentionally
unsuitable for multiple replicas or durable login sessions.

## Dedicated Keycloak client

Create a public OIDC client for Reef with Standard Flow enabled, PKCE S256, and
no implicit or resource-owner-password flow. Register exactly:

```text
redirect URI:      https://reef.example.com/api/auth/akb/sso/callback
post-logout URI:   https://reef.example.com/login
back-channel URI:  https://reef.example.com/api/auth/akb/sso/backchannel-logout
```

Browser authorization/logout endpoints and JWT `iss` verification stay pinned
to `REEF_KEYCLOAK_ISSUER`. Token, JWKS, revocation, and readiness calls use only
`REEF_KEYCLOAK_TRANSPORT_URL`; Reef never substitutes public ingress for that
production transport. It accepts only RS256 JWTs from the transport's fixed
JWKS endpoint and rejects token-directed `jku`, `jwk`, `x5u`, or `x5c` sources.

The Keycloak client/audience configuration must make these claims true:

- Access token: exact issuer, AKB API audience, `azp` equal to Reef's client id,
  payload `typ=Bearer`, a non-empty subject, and `identity_provider` equal to the
  selected provider alias.
- Initial ID token: exact issuer, Reef client audience and `azp`, the
  authorization nonce, the same subject, and a correct access-token hash when
  that optional token-endpoint claim is present. A refreshed ID token may omit
  `nonce` and `at_hash`; Reef requires the original nonce and current
  access-token hash when the provider does include them.

Configure a client scope/audience mapper for the AKB API and a provider-alias
claim mapper when those claims are not emitted by default. AKB must accept this
Keycloak access token as the bearer credential for its API.

## AKB public provider catalog

AKB remains the public provider-catalog and account authority. Its unauthenticated
auth config response for SSO uses the versioned shape below:

```json
{
  "schema_version": 2,
  "auth_mode": "sso",
  "local_auth": { "enabled": false },
  "keycloak": {
    "enabled": true,
    "browser_session_ready": true
  },
  "providers": [
    {
      "provider_type": "keycloak-oidc",
      "alias": "workforce",
      "display_name": "Company SSO",
      "login_url": "/api/v1/auth/sso/workforce/login"
    }
  ]
}
```

Reef requires its mode to agree with this catalog and uses only entries with a
non-null `login_url`. It validates the alias, replaces the catalog URL with its
own same-origin start route, and passes the alias only as `kc_idp_hint`. Reef
never follows or relays the AKB `login_url`.

### Legacy AKB config during the v2 rollout

The v0.11 BFF also accepts the older single-provider response while AKB is being
upgraded:

```json
{
  "local_auth": { "enabled": false },
  "keycloak": {
    "enabled": true,
    "login_url": "/api/v1/auth/keycloak/login",
    "sso_only": true,
    "enrollment_mode": "invite_only"
  }
}
```

This is a capability signal only. Reef requires the exact canonical legacy path,
projects the response to a one-provider v2 view with the fixed alias `legacy`,
and starts the same Reef-owned Authorization Code + PKCE flow as a native v2
catalog. It never calls the legacy AKB browser-login or JWT-exchange endpoints,
and preserves the legacy `local_auth` capability in the projected view. This
keeps the pre-v0.11 hybrid password+SSO surface when `sso_only` is false; an
explicit `sso_only: true` response still hides the password surface.

The legacy shape cannot identify a provider alias or report AKB browser
readiness. The compatibility projection therefore remains conservative: the
OIDC validator still requires `identity_provider=legacy` in the access token,
alongside every existing issuer, audience, `azp`, bearer-type, subject, and ID
token check. A deployment whose Keycloak token omits that claim or uses another
alias fails closed during token validation and must move to the versioned v2
catalog; Reef does not fall back to AKB's retired exchange flow.

## Login and token custody

1. `/login` reads the public AKB catalog. One enabled provider can redirect
   directly; multiple providers render explicit choices.
2. `/api/auth/akb/sso/start` validates the selected alias, creates PKCE, nonce,
   state, and a separate browser binding, then stores the encrypted one-time
   transaction server-side.
3. Keycloak returns only an authorization code and state to Reef's callback.
   Reef atomically consumes state, verifies the browser binding, exchanges the
   code at Keycloak, and validates the complete token set.
4. Reef projects the current Keycloak access token through `@reef/core` to AKB
   `/api/v1/auth/me`. AKB account denial or 401 prevents session creation.
5. Reef stores the token set in an AES-256-GCM encrypted Redis record and gives
   the browser a random 256-bit `__reef_session` httpOnly, SameSite=Lax handle.

At login Reef records one immutable absolute server-session deadline. Refresh
rotation can shorten storage TTL but cannot move that deadline, so copied
handles expire with the original session. Access, refresh, and ID tokens never enter browser-visible JavaScript, response
bodies, URLs, browser storage, or cookies. Redis keys contain only a hash of the
handle; sid/sub indexes, replay-jti markers, and index metadata contain only
hashes. Ciphertext is bound to its record key as GCM additional data.

Before forwarding an AKB request, Reef resolves the current access token. A
near-expiry token is refreshed under a bounded distributed lock and persisted
with an atomic revision compare-and-set, including rotated refresh credentials.
A rejected refresh deletes the session. A transient Keycloak/JWKS failure keeps
a still-valid session and access token; an expired token returns a bounded
temporary failure without deleting its record.

AKB remains the account authority. `membership_required`,
`account_suspended`, `identity_conflict`, and an AKB 401 invalidate the Redis
session and clear every established Reef auth cookie. Ordinary resource
permission denials do not sign the user out.

## Logout

The logout POST deletes the server session before clearing the browser carrier
and then best-effort revokes the refresh token. If authoritative Redis deletion
fails, it returns a retryable 503 and retains the cookie. It returns only a
fixed same-origin continuation path after success. The public follow-up GET is
state-free and constructs navigation from the canonical issuer, client id, and
Reef post-logout URI. Reef never puts `id_token_hint` or any token in a cookie,
body, URL, redirect, or log-facing error.

OpenID Back-Channel Logout accepts a form-encoded `logout_token` at the URI
above. Verification is pinned to RS256, the exact public issuer, and the
dedicated Reef client audience. `iss`, `aud`, `iat`, `jti`, the exact
`http://schemas.openid.net/event/backchannel-logout` event, and `sid` or `sub`
are required; `nonce` is prohibited and token age is bounded. A replay-protected
atomic Redis operation prefers `sid` when both identifiers exist, deletes all
matching records, and cleans both hashed indexes. A valid token with no matching
session still returns 200.

Changing `REEF_SESSION_ENCRYPTION_KEY` intentionally invalidates existing SSO
sessions. Plan key rotation as a sign-in reset unless a future release adds a
multi-key transition mechanism.

## Focused regression coverage

The security contract is concentrated in:

- `packages/web/src/server/auth/*.test.ts`
- `packages/web/src/lib/api/requestHelpers.sso.test.ts`
- `packages/web/src/app/api/auth/akb/sso/*/route.test.ts`
- `packages/web/src/app/api/auth/akb/logout/route.test.ts`
- `packages/web/src/lib/akb/loadAkbAuthConfig.test.ts`
- `packages/core/src/adapters/akb/workspace/auth.test.ts`

Platform readiness requires the dedicated client, exact callback/logout and
back-channel URIs, RS256 realm signing, AKB audience/provider mappers, an enabled
public AKB provider catalog, Redis connectivity, an independent encryption key,
and reachable JWKS over the in-cluster transport. Kubernetes readiness checks
these Redis/OIDC dependencies at `/api/readyz`; `/api/healthz` is liveness only.
