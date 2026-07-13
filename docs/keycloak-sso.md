# AKB Keycloak SSO Deployment Contract

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

`keycloak.sso_only=true` is the authoritative managed presentation policy: Reef
redirects a clean `/login` entry server-side with no panel flash. The optional
`REEF_SSO_AUTO_REDIRECT` variable only forces the same presentation for a hybrid
AKB. `local_auth.enabled=false` hides the password form and cannot be bypassed by
the `?password=1` / `?prompt=login` loop escape. Older AKB responses that omit
these additive fields default to local auth enabled and SSO-only disabled. When
Keycloak is disabled or the config request fails, Reef falls back to the panel;
on a config failure it preserves the standalone password-compatible behavior.

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

Before release, also smoke test a real AKB + Keycloak environment by completing
a login from `/login`, confirming `/api/auth/akb/me` returns the new actor,
checking that the intended `next` route is reached, then signing out from the
sidebar.
