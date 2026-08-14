# Deploying reef

reef ships as one mode-aware web service, **reef-web**, that talks to an
[akb](https://github.com/dnotitia/akb) backend. Local auth is stateless and keeps
AKB's JWT in an httpOnly cookie. SSO adds encrypted, expiring OIDC token custody
in Redis behind an opaque cookie handle. Monitored-repository and LLM
credentials remain deployment-managed server state.

This guide covers three ways to run it:

1. [Build the image](#1-build-the-image)
2. [Kubernetes with kustomize](#2-kubernetes-with-kustomize) (recommended for clusters)
3. [Docker Compose](#3-docker-compose) (single host / local trial)

See [Required environment](#required-environment) for the full env contract.

---

## 1. Build the image

reef-web builds from the repo-root [`Dockerfile`](../Dockerfile). The multi-stage
build first resolves the repository-pinned Turbo dependency, runs
`turbo prune @reef/web --docker`, installs only the pruned manifests and lockfile,
builds the Next.js `standalone` output, and runs it as a non-root user on port
`3000`. The final image contains the standalone runtime, static assets, and
public assets only; workspace source is not a runtime fallback.

```bash
# From the repository root
docker build -t reef-web:latest .

# For a cluster, build for the node architecture and push to your registry
docker buildx build --platform linux/amd64 \
  -t ghcr.io/myorg/reef-web:latest \
  --push .
```

The container listens on `3000`. `/api/healthz` is process liveness;
`/api/readyz` is dependency-aware Kubernetes readiness.

For a local image proof, build without credentials, run it as UID 1001 with an
ephemeral published port, and verify the health response:

```bash
docker build --no-cache -t reef-web:local .
docker run --rm --user 1001 -p 127.0.0.1:0:3000 \
  -e REEF_AUTH_MODE=local reef-web:local
```

Use the published port from Docker's output to request `/api/healthz`; the
runtime must return JSON with HTTP 200.

---

## 2. Kubernetes with kustomize

The manifests under [`deploy/k8s`](../deploy/k8s) are organized as a kustomize
**base + overlays** tree:

```
deploy/k8s/
  base/                 # neutral manifests — never deployed directly
    configmap.yaml      #   reef-web-config (env), placeholder values
    deployment.yaml     #   reef-web Deployment (image: reef-web:latest)
    service.yaml        #   reef-web Service on :3000
    ingress.yaml        #   reef-web Ingress (nginx, SSE-safe, cert-manager)
    kustomization.yaml
  overlays/
    example/            # copy-me template (placeholder values)
      kustomization.yaml
      patch-config.yaml
      patch-ingress.yaml
  deploy.sh             # build + push + apply helper
```

The base carries placeholder values (`reef.example.com`, an example akb backend
DNS name) and **no namespace**. Each overlay sets the namespace, the image
registry, the public host, and the akb backend URL for one environment.

### Create your overlay

Copy the example overlay and edit four things:

```bash
cp -r deploy/k8s/overlays/example deploy/k8s/overlays/my-cluster
```

1. **Namespace** — `kustomization.yaml` → `namespace:`. The namespace must
   already exist (reef-web does not create it).
2. **Image** — `kustomization.yaml` → `images[].newName` / `newTag`. Point this
   at the registry/repository you pushed to in step 1.
3. **Auth profile, akb backend, and public origin** — `patch-config.yaml`:
   - `REEF_AUTH_MODE` — keep `local`, or use `sso` only after completing
     [the SSO contract](keycloak-sso.md).
   - `AKB_BACKEND_URL` — the in-cluster DNS of your akb backend Service, e.g.
     `http://backend.<akb-namespace>.svc.cluster.local:8000` (substitute your
     akb namespace and Service name).
   - `REEF_PUBLIC_ORIGIN` — reef-web's canonical external origin; it must match
     the ingress host below.
4. **Public host** — `patch-ingress.yaml` → the `tls.hosts` entry and
   `rules[].host`.

### Provide optional capability secrets

The Deployment reads secrets from `reef-web-secret` in the same namespace. The
reference is optional for local auth when GitHub and AI are disabled.
Production SSO must provide `REEF_SESSION_REDIS_URL` and
`REEF_SESSION_ENCRYPTION_KEY` in this Secret; GitHub and LLM credentials remain
optional capabilities.

To enable AI, create the Secret with `REEF_LLM_API_KEY`:

```bash
kubectl create secret generic reef-web-secret \
  --namespace my-namespace \
  --from-literal=REEF_LLM_API_KEY=component-or-provider-key
```

Set `REEF_LLM_BASE_URL` and `REEF_LLM_MODEL` in the overlay ConfigMap at the
same time. The URL may point to OpenRouter or an akb-platform gateway; Reef does
not classify the endpoint or derive a deployment mode from it. All three values
enable AI, partial configuration fails closed, and no values is an intentionally
disabled capability. Authentication remains independent; an SSO deployment
without AI is valid once its required auth/session settings are present.

#### Upgrade an existing OpenRouter deployment

Older Kubernetes releases supplied `OPENROUTER_BASE_URL` and `REEF_LLM_MODEL`
from the base ConfigMap, while operators usually stored only
`OPENROUTER_API_KEY` in `reef-web-secret`. Migrate that shape before applying
this release; otherwise the surviving legacy key is an invalid partial LLM
configuration after the old base defaults are removed.

To keep AI enabled, add the provider-neutral key to the Secret with the same
value as `OPENROUTER_API_KEY`, and add both URL names plus the model to the
overlay ConfigMap:

```yaml
data:
  REEF_LLM_BASE_URL: "https://openrouter.ai/api/v1"
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1"
  REEF_LLM_MODEL: "deepseek/deepseek-v4-flash"
```

Keep both key names and both matching URL names through the rollout and rollback
window. That lets old and new pods run concurrently and keeps rollback safe;
remove the `OPENROUTER_*` aliases after the old image is no longer needed. To
disable AI instead, remove `OPENROUTER_API_KEY` from the Secret before applying
the manifests (or remove the Secret when it contains no other capability keys).
Then apply the overlay normally. Existing old pods keep their startup
environment until drained, while new pods start in the valid AI-disabled state.

`GET /api/healthz` is the dependency-free liveness endpoint. `GET /api/readyz`
validates auth configuration and, in SSO mode, proves Redis and Keycloak JWKS
reachability over the explicit in-cluster transport before returning 200. The legacy-
named `GET /api/ai/managed-platform` endpoint is an LLM capability declaration:
valid enabled and disabled states return 200, while malformed LLM configuration
returns 503. It must not be used as the workload readiness probe.

### TLS

The base Ingress requests a certificate via a cert-manager `ClusterIssuer`
named `letsencrypt-prod` (annotation `cert-manager.io/cluster-issuer`). Change
the issuer name to match your cluster, or drop the annotation and supply the
`reef-web-tls` Secret yourself. The nginx SSE annotations
(`proxy-buffering: "off"`, long `proxy-read/send-timeout`) **must stay** — they
keep `/api/agents/runs` chat streaming working through the proxy.

### Apply

Render and apply with kustomize directly:

```bash
kubectl apply -k deploy/k8s/overlays/my-cluster
```

Or use the helper script, which also builds and pushes the image. It injects
`${REGISTRY}/reef-web:latest` into the rendered manifests, so you can leave the
base image reference untouched:

```bash
REGISTRY=ghcr.io/myorg \
NAMESPACE=my-namespace \
KUSTOMIZE_DIR=deploy/k8s/overlays/my-cluster \
  deploy/k8s/deploy.sh
```

`deploy.sh` defaults `KUSTOMIZE_DIR` to `overlays/example` and `NAMESPACE` to
`reef`; point them at your own overlay/namespace. Before restarting the
Deployment, it also records a `kubernetes.io/change-cause` annotation so
`kubectl rollout history deployment/reef-web` identifies the deployed Reef
version and Git commit. The version defaults to the root package version and
the commit defaults to the current short `HEAD`; set `DEPLOY_VERSION`,
`DEPLOY_COMMIT`, or the complete `CHANGE_CAUSE` when deploying a different
artifact provenance.

---

## 3. Docker Compose

For a single host (or a quick local trial against a reachable akb backend),
run reef-web on its own and point it at an `AKB_BACKEND_URL`:

```yaml
# docker-compose.yml
services:
  reef-web:
    image: ghcr.io/myorg/reef-web:latest   # or build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      REEF_AUTH_MODE: local
      # akb backend reef-web talks to (reachable from the container)
      AKB_BACKEND_URL: http://akb-backend:8000
      # reef-web's canonical external origin (bare scheme://host[:port]).
      # For local-only use over http this may be http://localhost:3000.
      REEF_PUBLIC_ORIGIN: https://reef.example.com
      # Optional provider-neutral LLM config. Set all three or omit all three.
      REEF_LLM_API_KEY: ${REEF_LLM_API_KEY:?set REEF_LLM_API_KEY}
      REEF_LLM_BASE_URL: ${REEF_LLM_BASE_URL:?set REEF_LLM_BASE_URL}
      REEF_LLM_MODEL: ${REEF_LLM_MODEL:?set REEF_LLM_MODEL}
      # Deployment-managed GitHub App for monitored-repo features
      REEF_GITHUB_APP_ID: ${REEF_GITHUB_APP_ID:?set REEF_GITHUB_APP_ID}
      REEF_GITHUB_APP_INSTALLATION_ID: ${REEF_GITHUB_APP_INSTALLATION_ID:?set REEF_GITHUB_APP_INSTALLATION_ID}
      REEF_GITHUB_APP_PRIVATE_KEY: ${REEF_GITHUB_APP_PRIVATE_KEY:?set REEF_GITHUB_APP_PRIVATE_KEY}
      # Optional dev/CI fallback when no GitHub App is configured
      # REEF_GITHUB_PAT: ${REEF_GITHUB_PAT}
```

```bash
REEF_LLM_API_KEY="${REEF_LLM_API_KEY}" \
REEF_LLM_BASE_URL="${REEF_LLM_BASE_URL}" \
REEF_LLM_MODEL="${REEF_LLM_MODEL}" \
REEF_GITHUB_APP_ID=123456 \
REEF_GITHUB_APP_INSTALLATION_ID=789 \
REEF_GITHUB_APP_PRIVATE_KEY="$(cat github-app.private-key.pem)" \
docker compose up
```

Local auth needs no Reef database or volume. SSO uses an external Redis service;
do not mount token state into the web container. If AKB runs in the same Compose
project, use its service name in `AKB_BACKEND_URL`.

---

## Required environment

reef-web reads its configuration from the process environment (in Kubernetes:
the `reef-web-config` ConfigMap plus the optional `reef-web-secret` Secret).

| Variable | Required | Description |
| --- | --- | --- |
| `REEF_AUTH_MODE` | yes | Explicitly `local` or `sso`; missing and unknown values fail startup. |
| `AKB_BACKEND_URL` | yes | Base URL of the akb backend reef-web calls server-side. In-cluster this is a Service DNS name (`http://<service>.<namespace>.svc.cluster.local:8000`). |
| `REEF_PUBLIC_ORIGIN` | yes for SSO | Reef's canonical bare origin. It forms the exact OIDC callback and post-logout URIs; HTTPS is required outside localhost development. |
| `REEF_KEYCLOAK_ISSUER` | yes for SSO | Exact HTTPS Keycloak realm issuer used for browser authorization/logout and JWT `iss` verification. |
| `REEF_KEYCLOAK_TRANSPORT_URL` | production SSO | Distinct in-cluster Keycloak realm URL used for token, JWKS, revocation, and readiness traffic. Its exact realm path must match the canonical issuer; credentials, query/fragment, IP literals, and the public issuer host are rejected. |
| `REEF_KEYCLOAK_CLIENT_ID` | yes for SSO | Dedicated Reef public-client id. |
| `REEF_AKB_API_AUDIENCE` | yes for SSO | Audience required in Keycloak access tokens forwarded to AKB. |
| `REEF_SESSION_REDIS_URL` | production SSO | Redis or Redis-TLS URL for encrypted session records and refresh locks. Keep credential-bearing URLs in a Secret. |
| `REEF_SESSION_ENCRYPTION_KEY` | production SSO | Independent base64/base64url-encoded 32-byte AES key. Keep it in a Secret. |
| `REEF_LLM_API_KEY` | for enabled AI | Key for the configured OpenAI-compatible endpoint. Keep it in a Secret; never inline it in manifests or commit it. |
| `REEF_LLM_BASE_URL` | for enabled AI | OpenAI-compatible endpoint base URL. It may target OpenRouter or an akb-platform gateway. |
| `REEF_LLM_MODEL` | for enabled AI | Deployment-selected model id passed to the configured endpoint. |
| `OPENROUTER_API_KEY` | compatibility alias | Alias for `REEF_LLM_API_KEY`; prefer the provider-neutral name in new deployments. If both are set, their values must match. |
| `OPENROUTER_BASE_URL` | compatibility alias | Alias for `REEF_LLM_BASE_URL`; prefer the provider-neutral name in new deployments. If both are set, their normalized values must match. |
| `REEF_GITHUB_APP_ID` | yes for GitHub features | GitHub App id used to mint server-side installation tokens for monitored-repo listing, grounding, and activity scans. |
| `REEF_GITHUB_APP_INSTALLATION_ID` | yes for GitHub features | Installation id for the repository/org installation reef should read from. |
| `REEF_GITHUB_APP_PRIVATE_KEY` | yes for GitHub features | PEM private key for the GitHub App. Keep it in a Secret; literal `\\n` escapes are accepted and normalized at runtime. |
| `REEF_GITHUB_PAT` | no | Optional server-managed read-only PAT fallback for local development and CI when no GitHub App is configured. Keep it in a Secret; it is not a browser token and must not be used as the production primary credential. |
| `NODE_ENV` | recommended | Set to `production` in any real deployment — it enables the `Secure` cookie flag and the strict CSP. |

Optional tracing/observability:

| Variable | Description |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP base endpoint for trace export (the instrumentation appends `/v1/traces`). No-op when unset / nothing is listening. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated `key=value` headers for authenticating to the trace backend. Read once at startup; never logged. |
| `REEF_RESPONSE_LOG` | Set to `1` to emit the per-request `response` access line (status + duration) and the backend `core` observability lines (scan checkpoints, LLM token usage) on stdout in **any** environment. On by default only in development. See the access-line policy below. |
| `REEF_SLOW_REQUEST_MS` | Threshold in milliseconds at/above which a `response` line is logged at WARN instead of INFO, so a slow request stands out. Defaults to `1000`; a non-positive or non-numeric value falls back to the default. |
| `LOG_LEVEL` | pino level for backend stdout logs (`debug`/`info`/`warn`/`error`). Defaults to `debug` in development and `info` otherwise. |
| `NEXT_PUBLIC_AKB_WEB_URL` | Public URL of the akb web app, used to open a linked akb document in a new tab from an issue. Optional; when unset that action is hidden. |

Local AKB JWTs and SSO token sets are per-user credentials, not environment
variables. The local JWT stays in an httpOnly cookie; the SSO token set stays in
encrypted Redis and the browser gets only an opaque handle. GitHub and LLM
credentials are deployment-managed server secrets. The three `REEF_LLM_*`
values must be set together; with none set, AI routes are unavailable.

### Backend logging and the prod access-line policy

reef-web logs backend events as structured pino lines on stdout (pretty in
development, one JSON object per line otherwise) for a log collector to tail.
OpenTelemetry injects `trace_id` / `span_id` into each line so logs correlate
with exported traces.

The **per-request `response` access line** (method, route, status, duration) is
**deliberately off in production by default**. The reasoning is the standard
logs/traces separation: in a deployment that exports traces, request status and
timing already live on the request span in the trace backend, correlated to the
inbound `request` log by `trace_id`, so synthesizing a second stdout line per
request would be redundant noise. The inbound `request` line (emitted once at the
proxy) stays on in every environment. In local mode it may include the
**claimed** actor decoded from the AKB JWT cookie; AKB remains the verifier. An
opaque SSO handle carries no actor claim and is never decoded or logged. Actor
metadata is a debug aid only, never authorization input or OTel `enduser.id`.

This leaves one gap: a deployment that runs **without a trace backend** would see
no response status/duration anywhere, and the richer backend signals (activity-
scan checkpoints, LLM token usage, upstream latency) — which are emitted as span
attributes for the trace backend — would be invisible. For that case, set
`REEF_RESPONSE_LOG=1`. It turns on the stdout `response` access line **and** wires
the backend `core` observability lines, so the same data that would otherwise only
reach traces is also visible on stdout. Slow requests are promoted to WARN at the
`REEF_SLOW_REQUEST_MS` threshold so they stand out in that stream.

Credentials never reach any log: the proxy reads only the public actor claim from
the session cookie (never the token), credential headers are redacted by the
pino config, and typed API errors surface only their numeric upstream HTTP
status — not the upstream-controlled detail body (an LLM provider response, an
Octokit message) and not the nested request/response objects that carry
credentials.
