# AKB Keycloak SSO and auth-v2 Contract

> **Status:** The deployed/mainline path is still AKB-delegated authentication
> (the pre-#310 contract restored by #357). The Reef-owned auth-v2 path below is
> a future, explicitly opted-in contract. `REEF_AUTH_V2_ENABLED` is not enabled
> by this document or by the current default deployment. Do not set it until
> AKB has implemented and verified the v2 prerequisites.

## Implementation status and activation boundary

This change adds the versioned core contract, server-only OIDC/PKCE and Redis
primitives, and their fail-closed tests. It deliberately does not cut the
current `/api/auth/akb/*` Route Handlers over to those primitives: mainline
authentication remains the AKB-owned browser login, one-time-code exchange,
and AKB JWT cookie restored by #357. `REEF_AUTH_V2_ENABLED` is therefore a
reserved rollout gate in this release, not a switch that silently changes the
live routes. A follow-up cutover must wire the route/session boundary, pass the
AKB contract tests below, and be canaried before the flag is enabled. There is
no temporary fallback between the two profiles.

## Current contract: AKB-delegated authentication

reef does not own a Keycloak client, realm, or client secret. For SSO, reef
delegates login to AKB, exchanges AKB's one-time code server-side, and stores
the returned AKB JWT in the same `__reef_session` httpOnly cookie used by
password login.

## Reef Environment

reef-web needs only the AKB backend origin:

```bash
AKB_BACKEND_URL=https://akb.example.com
```

Do not add `NEXT_PUBLIC_*` SSO variables. Browser code starts SSO through reef's
same-origin Route Handlers; secrets and tokens stay server-side or in httpOnly
cookies.

## AKB And Keycloak Configuration

Keycloak should redirect back to AKB, not reef:

```yaml
keycloak_redirect_uri: https://akb.example.com/api/v1/auth/keycloak/callback
```

AKB should then send the reef product surface a one-time code by setting the
post-login path to reef's callback:

```yaml
keycloak_post_login_path: https://reef.example.com/api/auth/akb/sso/callback
```

If AKB and reef share an origin, this can be a safe same-site path. If they are
on different origins, use the absolute reef URL. The Keycloak client must allow
the AKB callback URL configured in `keycloak_redirect_uri`.

AKB's public auth config endpoint must return the nested shape used by reef:

```json
{
  "local_auth": {
    "enabled": false
  },
  "keycloak": {
    "enabled": true,
    "login_url": "/api/v1/auth/keycloak/login",
    "sso_only": true,
    "enrollment_mode": "invite_only"
  }
}
```

`login_url` must be the path-only AKB endpoint
`/api/v1/auth/keycloak/login`. reef rejects absolute, protocol-relative, query,
fragment, or non-Keycloak paths before making any server-side request.

`local_auth.enabled` controls whether the password form is available. When AKB
advertises both local authentication and Keycloak, Reef renders the hybrid
password + SSO panel by default. A clean `/login` entry redirects to SSO only
when the deployment explicitly sets `REEF_SSO_AUTO_REDIRECT=1`; the
`keycloak.sso_only` capability flag alone does not grant Reef permission to
redirect. `local_auth.enabled=false` means AKB has deliberately disabled the
password method; the `?password=1` / `?prompt=login` parameters cannot bypass
that capability decision. When Keycloak is disabled or the config request fails,
Reef keeps the panel and the standalone password path available.

## Login Success Flow

1. The login page reads `GET /api/auth/akb/config`, which proxies AKB
   `GET /api/v1/auth/config`.
2. The SSO button points to
   `/api/auth/akb/sso/start?redirect=<safe-reef-path>`.
3. The start route creates a short-lived nonce, builds
   `/login/sso-complete?state=<nonce>&next=<safe-reef-path>`, and sends the
   browser through reef's `/api/auth/akb/sso/login` proxy.
4. The login proxy calls AKB
   `GET /api/v1/auth/keycloak/login?redirect=<safe-callback-path>` and relays
   only AKB's public Keycloak redirect URL.
5. After Keycloak login, AKB redirects to
   `keycloak_post_login_path?code=<one-time-code>&redirect=<safe-path>`.
6. reef exchanges the one-time code with AKB
   `POST /api/v1/auth/keycloak/exchange` and receives `{ token, user,
   kc_id_token? }`.
7. reef sets `__reef_session`, marks the session as SSO-backed when applicable,
   clears the start nonce, and routes through `/login/sso-complete` so the
   client verifies the actor before going to the intended page.

The AKB JWT is never exposed to browser JavaScript. The optional Keycloak ID
token is stored only in httpOnly cookies for SSO logout continuation.

AKB remains the account authority after Keycloak authentication. When AKB
returns `membership_required`, `account_suspended`, or `identity_conflict`, it
may return that stable code to Reef's allowlisted callback. Reef validates the
existing SSO nonce and completion path before accepting the code, shows curated
product copy, and clears every established Reef auth cookie. The same mapping
applies to password login and later `/auth/me` rejection, so a revoked or
suspended account cannot continue through a stale local session. Protected Reef
API responses also emit `X-Reef-Auth-Invalidated: 1`; the shared browser client
uses that signal to clear persisted and in-memory AKB-account-scoped state while
leaving ordinary permission denials intact.

## Sign-Out Flow

Password and local sign-out always clear `__reef_session` and AKB-scoped browser
state. GitHub access is deployment-managed and is not affected by user sign-out.

For SSO-backed sessions, reef also:

- clears the long-lived local SSO cookies in the initial POST response;
- moves the Keycloak ID token hint into a separate short-lived httpOnly
  continuation cookie;
- requires a matching one-time logout nonce on the follow-up GET route;
- sends the ID token hint to AKB in a server-side POST body, never in the AKB
  request URL;
- performs a top-level browser navigation for the continuation route so the
  browser can reach the external Keycloak logout URL.

If the AKB logout endpoint is unavailable or does not return a public redirect,
reef still completes local cleanup and falls back to `/login`.

### Why auth-v2 is a separate contract

The #310 implementation made Reef the OIDC client but sent the resulting
Keycloak access token through AKB's legacy account/session path. That path
expects AKB's own JWT/resource contract, so a token with a different issuer or
audience failed account validation. #346 projected an older single-provider
capability response and #347 repaired the hybrid presentation, but neither
defined a new AKB account authority boundary; #355 only corrected provider-hint
handling for a direct realm login. #357 therefore restored the delegated
AKB-login and one-time-code exchange path now used by main. Auth-v2 keeps the
useful OIDC/Redis design while making the missing contract explicit: a strict
versioned provider catalog, pinned token policy, and a dedicated AKB
`/api/v2/auth/account-validation` endpoint. No UI or token-validation patch can
substitute for that AKB-side boundary.

## Future contract: Reef-owned auth-v2 (explicit opt-in)

Auth-v2 makes Reef the OIDC authorization-code + PKCE client while AKB remains
the account authority. It is intentionally a new contract, not a compatibility
projection of the legacy AKB login/exchange endpoints. The future route cutover
is allowed only when every required setting is present and
`REEF_AUTH_V2_ENABLED=1`; this release keeps the gate off:

```bash
REEF_AUTH_V2_ENABLED=1
REEF_PUBLIC_ORIGIN=https://reef.example.com
REEF_KEYCLOAK_ISSUER=https://identity.example.com/realms/reef
REEF_KEYCLOAK_TRANSPORT_URL=http://keycloak.identity.svc.cluster.local:8080/realms/reef
REEF_KEYCLOAK_CLIENT_ID=reef-web
REEF_AKB_API_AUDIENCE=akb-api
REEF_SESSION_REDIS_URL=rediss://redis.example.com:6380/0
REEF_SESSION_ENCRYPTION_KEY=<independent-32-byte-key>
```

Missing or partial configuration fails closed. There is no fallback from an
auth-v2 error to the legacy AKB exchange flow, and an auth-v2 deployment must
not silently switch to the current delegated session contract. Keep the flag
off until the AKB and Keycloak prerequisites below are complete.

### AKB v2 config and provider catalog

AKB must publish an unauthenticated `GET /api/v2/auth/config` response matching
this strict shape (unknown or missing contract fields are configuration errors):

```json
{
  "schema_version": 2,
  "auth_mode": "sso",
  "local_auth": { "enabled": true },
  "canonical_issuer": "https://identity.example.com/realms/reef",
  "accepted_audiences": ["akb-api"],
  "accepted_clients": ["reef-web"],
  "token_validation": {
    "algorithms": ["RS256"],
    "access_token_type": "Bearer",
    "provider_claim": "identity_provider"
  },
  "account_validation": {
    "endpoint": "/api/v2/auth/account-validation",
    "credential": "bearer_access_token",
    "requires_subject_binding": true,
    "denial_codes": [
      "membership_required",
      "account_suspended",
      "identity_conflict"
    ]
  },
  "keycloak": { "enabled": true, "browser_session_ready": true },
  "providers": [
    {
      "provider_type": "keycloak-oidc",
      "alias": "workforce",
      "display_name": "Company SSO",
      "login_url": "/api/v2/auth/providers/workforce/login"
    }
  ]
}
```

`canonical_issuer`, `accepted_audiences`, `accepted_clients`, and the
`token_validation` object are the shared Reef/AKB validation contract; Reef
must not infer them from a request or a token. Provider aliases are bounded
identifiers. `providers[].login_url` is a path-only capability declaration;
the future route cutover validates the alias and starts its own same-origin
auth-v2 route rather than following or relaying an AKB URL. The catalog's
`local_auth.enabled=true` is the normal hybrid presentation: password and SSO
are both visible. An explicit SSO-first redirect still requires
`REEF_SSO_AUTO_REDIRECT=1`; `sso_only` by itself is not an auto-redirect
instruction in auth-v2. If AKB sets `local_auth.enabled=false`, that is an
explicit deployment prerequisite to hide password login, not a Reef fallback or
an implicit mode switch.

The same schema has a local-only discriminant for an AKB deployment that has no
OIDC provider: `auth_mode` is `"local"`, `canonical_issuer` is `null`,
`accepted_audiences` and `accepted_clients` are empty arrays, `providers` is an
empty array, and `keycloak.enabled` is `false`. Reef does not project a legacy
response into this shape, and a v2 deployment must keep the catalog's
`auth_mode` and provider capabilities aligned with its chosen login surface.

### Authentication and account-validation boundary

The auth-v2 flow is deliberately split into two checks:

1. Reef creates one-time state, nonce, PKCE, and browser binding, then exchanges
   the authorization code at Keycloak. It validates the returned token set
   locally: exact `iss` equal to `canonical_issuer`, RS256 with a required key
   id, an accepted access-token audience, an accepted client (`azp`), bearer
   type, non-empty subject, provider claim (`identity_provider`) equal to the
   selected provider alias, and bounded time claims. Token-directed `jku`,
   `jwk`, `x5u`, and `x5c` sources are rejected.
2. Only after those checks, Reef calls AKB's exact
   `POST /api/v2/auth/account-validation` endpoint with the current access
   token as a server-side `Authorization: Bearer …` header and a body binding
   the selected `provider_alias` and token `subject`. AKB validates membership,
   suspension, identity conflicts, and the account/user projection. Reef never
   infers AKB account eligibility from OIDC claims and never falls back to
   `/api/v1/auth/me` or a legacy token exchange.

AKB returns an account/user projection on success, or one of the stable denial
codes `membership_required`, `account_suspended`, and `identity_conflict`.
Those denials, an AKB 401, or a failed subject binding prevent session creation,
clear every Reef auth cookie, and surface the existing curated login copy.
Resource-level permission denials remain ordinary authorization failures and do
not sign the user out.

### Token custody and transport invariants

After account validation succeeds, Reef stores the access/refresh/ID token set
only in an AES-256-GCM encrypted Redis record and gives the browser a random
opaque `__reef_session` handle. The encryption key is an independent 32-byte
deployment secret. Redis keys are hashes, ciphertext is bound to its record key
as additional authenticated data, and refresh rotation uses bounded locking
plus an atomic compare-and-set. The follow-up route cutover must add hashed
back-channel logout indexes and replay markers before advertising that endpoint.
A login-time absolute deadline cannot be extended by refresh.

Access/refresh/ID tokens and provider response bodies never appear in browser
JavaScript, response bodies, browser storage, cookies, logs, traces, or error
text. OIDC requires opaque `state`, `nonce`, and `code_challenge` values in the
authorization URL, and returns a one-time authorization code to the callback;
Reef consumes those values server-side, never logs or persists the code, and
never places a token in a URL. The PKCE verifier remains server-side, and
`id_token_hint` is not placed in a cookie or URL. Production auth-v2 requires
Redis, the independent key, and a distinct in-cluster Keycloak transport.
Browser authorization/logout and JWT issuer checks use
`REEF_KEYCLOAK_ISSUER`; token, JWKS, revocation, and readiness traffic use
`REEF_KEYCLOAK_TRANSPORT_URL`, whose exact realm path must match the canonical
issuer and which must not be public ingress, an IP literal, or a URL carrying
credentials/query/fragment. Readiness fails closed if these dependencies are
missing or unreachable. There is no in-memory or legacy fallback for a
production auth-v2 deployment.

### AKB prerequisites and rollout guard

Before enabling the flag, AKB must ship and contract-test the v2 config catalog
and account-validation endpoint, return a catalog whose issuer/audience/client
values match the Keycloak client, verify the `provider_alias` + `subject` binding,
and preserve the three stable denial codes. The dedicated Keycloak client must
register Reef's exact callback, post-logout, and back-channel logout URIs and
emit the claims above. In particular, the #357 AKB response that advertises
`auth_mode=sso` while disabling the password capability is not sufficient for
the default hybrid UX; AKB must advertise `local_auth.enabled=true` when both
methods are intended.

Roll out with the flag disabled, validate `/api/v2/auth/config`, account-denial
and account-success contract tests against AKB, then canary auth-v2 with Redis
and transport readiness before enabling more replicas. A missing AKB feature is
an explicit rollout blocker to record in the Draft PR; do not hide it behind a
Reef-side fallback.

## Known Follow-Up

REEF-118 tracks the remaining AKB-side hooks for reef-returning SSO UX:

- Keycloak post-logout redirect currently returns to AKB's auth surface unless
  AKB adds a safe reef-returning hook such as an allowlisted parameter or
  `keycloak_post_logout_path`.
- Keycloak callback errors currently return to AKB's auth surface unless AKB
  adds a safe reef login/error redirect hook.

These are not blockers for the login success path. When REEF-118 lands, update
this document with the exact endpoint, parameter or config names, allowlist
semantics, and fallback behavior before wiring any additional reef UX.

## Regression Coverage

Focused coverage for this contract lives in:

- `packages/core/src/adapters/akb/workspace/auth.test.ts`
- `packages/web/src/app/api/auth/akb/config/route.test.ts`
- `packages/web/src/app/api/auth/akb/sso/start/route.test.ts`
- `packages/web/src/app/api/auth/akb/sso/login/route.test.ts`
- `packages/web/src/app/api/auth/akb/sso/callback/route.test.ts`
- `packages/web/src/app/api/auth/akb/logout/route.test.ts`
- `packages/web/src/app/api/auth/akb/sso/logout/route.test.ts`
- `packages/web/src/app/login/page.test.tsx`
- `packages/web/src/app/login/sso-complete/page.test.tsx`
- `packages/web/src/features/auth/components/LoginPanel.test.tsx`
- `packages/web/src/features/auth/components/SidebarAccount.test.tsx`
- `packages/web/src/lib/akb/accountReconcile.test.ts`

Auth-v2 contract coverage is separate and must remain fail-closed:

- `packages/core/src/adapters/akb/workspace/authV2.test.ts` validates the strict
  v2 catalog, provider URLs, denial-code set, and exact account-validation wire
  request; legacy `/api/v1/auth/config` responses are rejected rather than
  projected.
- `packages/web/src/lib/akb/loadAkbAuthV2Config.test.ts` validates the AKB
  capability boundary and its unavailable/mismatch outcomes.
- `packages/web/src/server/auth-v2/config.test.ts` and
  `packages/web/src/server/auth-v2/oidcValidator.test.ts` cover opt-in
  configuration, canonical issuer/transport separation, accepted audience and
  client claims, RS256/JWK pinning, provider binding, and bounded clock skew.
- `packages/web/src/server/auth-v2/oidcProtocol.test.ts` covers the complete
  code-to-account-validation boundary, PKCE state binding, token checks, and
  account-validation-before-result behavior.
- `packages/web/src/server/auth-v2/loginStateStore.test.ts`,
  `sessionStore.test.ts`, `redisBackend.test.ts`, `redisRuntime.test.ts`,
  `refreshLock.test.ts`, and `readiness.test.ts` cover encrypted one-time
  state, opaque sessions, atomic Redis operations, refresh locking, and
  dependency readiness without token-bearing diagnostics.

Before release, also smoke test a real AKB + Keycloak environment by completing
a login from `/login`, confirming `/api/auth/akb/me` returns the new actor,
checking that the intended `next` route is reached, then signing out from the
sidebar.
