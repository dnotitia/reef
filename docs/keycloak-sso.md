# Companion OIDC SSO

Reef supports the current AKB human-authentication contract only. AKB publishes an unauthenticated schema_version: 2 capability catalog from GET /api/v1/auth/config. The catalog is authoritative for the exclusive local or sso mode, the ready provider list, and the keycloak-oidc or local-realm provider types.

## Deployment contract

Local mode requires only:

    REEF_AUTH_MODE=local
    AKB_BACKEND_URL=https://akb.example.com

SSO mode additionally requires:

    REEF_AUTH_MODE=sso
    REEF_PUBLIC_ORIGIN=https://reef.example.com
    REEF_KEYCLOAK_ISSUER=https://identity.example.com/realms/reef
    REEF_KEYCLOAK_TRANSPORT_URL=http://keycloak.identity.svc.cluster.local:8080/realms/reef
    REEF_KEYCLOAK_CLIENT_ID=reef-web
    REEF_AKB_API_AUDIENCE=https://akb.example.com/api
    REEF_SESSION_REDIS_URL=rediss://redis.example.com:6379/0
    REEF_SESSION_ENCRYPTION_KEY=<32-byte-base64-key>
    REEF_AUTH_SESSION_NAMESPACE=reef-sso-<epoch>

The public issuer, companion client id, API audience, callback, post-logout URI, and back-channel logout URI must be registered with the actual AKB and Keycloak deployment. Reef does not create Secrets or change Keycloak/AKB administrative configuration. Production SSO fails closed without authenticated Redis, an independent AES-256-GCM key, or a fresh deployment namespace. Change the namespace on an auth mode, issuer, client, or session-key cutover; do not reuse a previous SSO namespace after sso → local → sso.

## Browser flow

1. Reef reads AKB's v2 catalog and shows only providers with a non-null login_url. A provider selection is bound to a one-time Redis transaction.
2. Reef creates a fixed-origin Authorization Code + PKCE S256 request. Brokered providers receive kc_idp_hint=<alias>; local-realm receives no broker hint. max_age=0 is requested.
3. The callback consumes state and browser binding atomically, revalidates the current provider catalog, exchanges the code at the configured Keycloak token endpoint, and verifies the access and ID token profiles.
4. Reef calls AKB /api/v1/auth/me with the verified access token. AKB is the account and permission authority; Reef never adopts a provider username, email, or subject as a Reef account.
5. Redis stores the access, refresh, and ID tokens encrypted with AES-256-GCM. The browser receives only the opaque __reef_auth_v2 handle. The __reef_session cookie is accepted only in local mode.
6. Product HTTP and stream adapters resolve the current SSO credential at the request/stream boundary. Expired access tokens use a Redis-backed per-session refresh lock and conditional rotation; product writes are not replayed.

## Token profile

Access tokens are pinned to RS256, typ=JWT, typ=Bearer, the configured issuer and AKB API audience, azp=REEF_KEYCLOAK_CLIENT_ID, and required exp, iat, jti, sid, sub, and scope claims. Brokered tokens require identity_provider equal to the selected alias; local-realm tokens must omit that claim. Untrusted key-source headers (jku, jwk, x5u, x5c), other algorithms, ID/refresh tokens used as API credentials, wrong audiences, admin/service clients, and malformed time claims are rejected.

ID tokens are verified against the companion client audience, issuer, azp, sub, sid, nonce, and the RS256 at_hash profile. The initial response requires at_hash and auth_time for the max_age=0 request. Refresh validation is separate and never uses an unverified access token.

## Logout and denial behavior

Same-origin POST logout revokes the Reef handle first. Redis failure returns a retryable error and does not claim logout success. Refresh-token revocation is best effort after local custody is gone. The follow-up redirect is a one-time same-origin route that builds a tokenless Keycloak logout URL with the trusted issuer, client id, and fixed /login post-logout path.

The back-channel endpoint verifies the signed logout token's issuer, audience, RS256 signature, time claims, jti, sid, and back-channel events claim, then revokes only sessions indexed by that sid. Replay is idempotent. Access/refresh/ID tokens and raw cookies are never logged.

AKB credential rejection and stable account denials (membership_required, account_suspended, identity_conflict) invalidate the matching Reef session. Resource-level 403, external-provider 401, and bounded transport/JWKS/Redis outages do not sign out a valid session.

## Readiness and verification

Readiness checks are bounded and non-authenticating: configuration, Redis reachability, and a usable pinned JWKS. They do not perform login or refresh. Hermetic tests cover local and SSO mode gates, provider selection, local-realm claim differences, PKCE/state/nonce binding, access/ID token rejection, encrypted custody, CAS refresh, lock/logout ordering, CSRF, and token non-disclosure. A real AKB + Keycloak companion client, account, and Redis are required for SSO operational cutover evidence. If that environment is absent, record the real SSO check as not_run and keep the implementation candidate separate from that deployment decision.
