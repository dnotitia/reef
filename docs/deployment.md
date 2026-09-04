# Deploying reef

reef ships as a single web service, **reef-web**, that talks to an
[akb](https://github.com/dnotitia/akb) backend. Local mode persists no product
state of its own: the AKB session lives in an httpOnly cookie. SSO mode uses
deployment-managed Redis only for encrypted OIDC custody, one-time login state,
and refresh locks. Monitored repositories are
accessed through deployment-managed GitHub credentials, and LLM config is
deployment-managed server state. That means deployment is just "run the
container, point it at akb, and optionally give it one OpenAI-compatible LLM
endpoint plus GitHub configuration."

This guide covers three ways to run it:

1. [Build the image](#1-build-the-image)
2. [Kubernetes with kustomize](#2-kubernetes-with-kustomize) (recommended for clusters)
3. [Docker Compose](#3-docker-compose) (single host / local trial)

See [Required environment](#required-environment) for the full env contract.

---

## 1. Build the image

reef-web builds from the repo-root [`Dockerfile`](../Dockerfile). The builder
copies the full source tree, runs the frozen repository install so Git-hosted
workspace dependencies can prepare their artifacts, builds the Next.js
`standalone` output, and runs it as a non-root user on port `3000`. The final
image contains the standalone runtime, static assets, and public assets only;
workspace source is not a runtime fallback.

```bash
# From the repository root
docker build -t reef-web:local .

# For a cluster, use the release CLI. It pushes one unique build tag, records
# the digest returned by buildx, and never moves an existing version/source tag.
REGISTRY=ghcr.io/myorg \
REEF_BUILD_ARTIFACT=/tmp/reef-build.json \
  deploy/k8s/deploy.sh build
```

The container listens on `3000` and exposes a health endpoint at
`/api/healthz` (used by the Kubernetes liveness/readiness probes).

For a local image proof, build without credentials, run it as UID 1001 with an
ephemeral published port, and verify the health response:

```bash
docker build --no-cache -t reef-web:local .
docker run --rm --user 1001 -p 127.0.0.1:0:3000 reef-web:local
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
    deployment.yaml     #   reef-web Deployment (neutral digest placeholder)
    service.yaml        #   reef-web Service on :3000
    ingress.yaml        #   reef-web Ingress (nginx, SSE-safe, cert-manager)
    kustomization.yaml
  overlays/
    example/            # copy-me template (placeholder values)
      kustomization.yaml
      patch-config.yaml
      patch-ingress.yaml
  deploy.sh             # immutable register/rollout/apply CLI
```

The base carries placeholder values (`reef.example.com`, an example akb backend
DNS name) and **no namespace**. Each overlay sets the namespace, public host,
and akb backend URL for one environment; the one-shot CLI supplies the
immutable image repository and digest at deploy time.

### Create your overlay

Copy the example overlay and edit three things:

```bash
cp -r deploy/k8s/overlays/example deploy/k8s/overlays/my-cluster
```

1. **Namespace** — `kustomization.yaml` → `namespace:`. The namespace must
   already exist (reef-web does not create it).
2. **akb backend + public origin** — `patch-config.yaml`:
   - `AKB_BACKEND_URL` — the in-cluster DNS of your akb backend Service, e.g.
     `http://backend.<akb-namespace>.svc.cluster.local:8000` (substitute your
     akb namespace and Service name).
   - `REEF_PUBLIC_ORIGIN` — reef-web's canonical external origin; it must match
     the ingress host below.
3. **Public host** — `patch-ingress.yaml` → the `tls.hosts` entry and
   `rules[].host`.

### Provide optional capability secrets

The Deployment reads optional GitHub and LLM credentials, and production SSO
Redis/encryption settings, from a Secret named `reef-web-secret` in the same
namespace. Local AKB-only deployments may omit the Secret; SSO deployments
must provide its auth custody values.

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
disabled capability. Keycloak remains independent, so a Keycloak-only
deployment is valid.

`GET /api/healthz` is the Reef workload liveness endpoint. `GET /api/readyz`
performs the bounded mode-aware readiness check, including SSO Redis and pinned
JWKS when SSO is enabled. The legacy-
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

### Register and deploy

Use the one-shot CLI for a normal release. It builds and pushes one unique
source/version-bound build tag, reads the OCI digest from buildx, validates the
committed Blueprint and final Manifest, registers or replays the App and
Release, waits for AKB to report `applied`, then renders and applies the
Kubernetes revision with the same digest and release identity. It never moves
an existing mutable version or source tag, and exits non-zero for blocked,
pending, timeout, readiness, or identity-readback failures.

```bash
REGISTRY=ghcr.io/myorg \
AKB_BACKEND_URL=https://akb.example.com \
REEF_CONTROL_PLANE_TOKEN="$REEF_CONTROL_PLANE_TOKEN" \
NAMESPACE=my-namespace \
KUSTOMIZE_DIR=deploy/k8s/overlays/my-cluster \
REEF_BUILD_ARTIFACT=/tmp/reef-build.json \
REEF_RELEASE_RECEIPT=/tmp/reef-release.json \
  deploy/k8s/deploy.sh deploy
```

For a registration-only handoff (including a new AKB installation with no
targets), first run the build-only command. It pushes one unique build tag and
writes the identity artifact without contacting AKB or Kubernetes:

```bash
REGISTRY=ghcr.io/myorg \
REEF_BUILD_ARTIFACT=/tmp/reef-build.json \
  deploy/k8s/deploy.sh build
```

Then register that artifact. This command never asks for rollout status and
never mutates Kubernetes:

```bash
AKB_BACKEND_URL=https://akb.example.com \
REEF_CONTROL_PLANE_TOKEN="$REEF_CONTROL_PLANE_TOKEN" \
REEF_RELEASE_RECEIPT=/tmp/reef-registration.json \
  deploy/k8s/deploy.sh register \
    --build-artifact /tmp/reef-build.json
```

The build artifact is written by the normal build path and contains
`image_repository`, `image_digest`, `image_reference`, `source_revision`, and
the root `version`. register-only compares all of them with the current clean
checkout before finalizing the Manifest; a bare digest is rejected. The
registration receipt is a safe handoff containing `app_id`, `release_id`,
`image_repository`, product version, full source revision, image digest,
manifest checksum, and the replay flags. Keep both files outside the repository
so the clean-source check does not treat them as product changes.

If AKB reports a blocked rollout, fix the cause and explicitly resume the same
source job with a new idempotency key. The receipt supplies the original
release coordinates and image identity:

```bash
AKB_BACKEND_URL=https://akb.example.com \
REEF_CONTROL_PLANE_TOKEN="$REEF_CONTROL_PLANE_TOKEN" \
REEF_RELEASE_RECEIPT=/tmp/reef-release.json \
  deploy/k8s/deploy.sh resume \
    --source-rollout-id <blocked-job-uuid> \
    --request-key <new-resume-uuid>
```

The CLI derives provenance from the root package version and full `HEAD`; it
does not accept version/commit identity overrides or deploy a mutable `latest`
reference. `kubernetes.io/change-cause` and the `REEF_RELEASE_*` PodTemplate
environment variables include the verified App/Release IDs, source revision,
digest, and manifest checksum. The fixed `reef-web-config` ConfigMap remains
for stable workload settings and is not rewritten with release identity, so an
older ReplicaSet cannot observe a later release's coordinates. The control-
plane credential is used only by the one-shot process and is removed from child
command environments and rendered workload configuration.

---

## 3. Docker Compose

For a single host (or a quick local trial against a reachable akb backend),
run reef-web on its own and point it at an `AKB_BACKEND_URL`:

```yaml
# docker-compose.yml
services:
  reef-web:
    image: ghcr.io/myorg/reef-web@sha256:<verified-digest>   # or build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
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

reef-web has no product database or volume to manage. SSO deployments must
provide the external authenticated Redis configured above. If your
akb backend runs in the same Compose project, give it a service name and use
that as the host in `AKB_BACKEND_URL` (e.g. `http://akb-backend:8000`).

---

## Required environment

reef-web reads its configuration from the process environment (in Kubernetes:
the `reef-web-config` ConfigMap plus the optional `reef-web-secret` Secret).

| Variable | Required | Description |
| --- | --- | --- |
| `AKB_BACKEND_URL` | yes | Base URL of the akb backend reef-web calls server-side. In-cluster this is a Service DNS name (`http://<service>.<namespace>.svc.cluster.local:8000`). |
| `REEF_AUTH_MODE` | yes | Explicit `local` or `sso`; must match AKB's `schema_version=2` `auth_mode`. No hybrid or legacy fallback is supported. |
| `REEF_PUBLIC_ORIGIN` | yes for SSO | Reef's canonical external origin — bare `scheme://host[:port]`, no path. It is used for the fixed OIDC callback and post-logout redirect and must match the registered companion origin. |
| `REEF_KEYCLOAK_ISSUER` | yes for SSO | Public Keycloak realm issuer used for browser authorization and JWT `iss`. |
| `REEF_KEYCLOAK_TRANSPORT_URL` | yes in production SSO | Private/in-cluster realm URL used for token, JWKS, and revocation calls. Its realm path must match the issuer. |
| `REEF_KEYCLOAK_CLIENT_ID` | yes for SSO | Dedicated Reef companion client id, registered in AKB's human API allowlist. |
| `REEF_AKB_API_AUDIENCE` | yes for SSO | Exact AKB human API audience required on the Keycloak access token. |
| `REEF_SESSION_REDIS_URL` | yes in production SSO | Authenticated Redis endpoint for encrypted session/login-state custody and refresh locks. |
| `REEF_SESSION_ENCRYPTION_KEY` | yes in production SSO | Independent 32-byte AES-256-GCM key, base64/base64url encoded, stored in the deployment Secret. |
| `REEF_AUTH_SESSION_NAMESPACE` | yes in production SSO | Deployment-managed namespace/epoch for encrypted session records. Change it for mode, issuer, client, key, or record-schema cutover; old records are not parsed or migrated. Never reuse an old SSO namespace. |
| `REEF_SSO_AUTO_REDIRECT` | no | Explicit opt-in to automatic entry when exactly one AKB provider is ready. It does not enable SSO or provide a local fallback. |
| `REEF_LLM_API_KEY` | for enabled AI | Key for the configured OpenAI-compatible endpoint. Keep it in a Secret; never inline it in manifests or commit it. |
| `REEF_LLM_BASE_URL` | for enabled AI | OpenAI-compatible endpoint base URL. It may target OpenRouter or an akb-platform gateway. |
| `REEF_LLM_MODEL` | for enabled AI | Deployment-selected model id passed to the configured endpoint. |
| `REEF_GITHUB_APP_ID` | yes for GitHub features | GitHub App id used to mint server-side installation tokens for monitored-repo listing and read-only grounding. |
| `REEF_GITHUB_APP_INSTALLATION_ID` | yes for GitHub features | Installation id for the repository/org installation reef should read from. |
| `REEF_GITHUB_APP_PRIVATE_KEY` | yes for GitHub features | PEM private key for the GitHub App. Keep it in a Secret; literal `\\n` escapes are accepted and normalized at runtime. |
| `REEF_GITHUB_PAT` | no | Optional server-managed read-only PAT fallback for local development and CI when no GitHub App is configured. Keep it in a Secret; it is not a browser token and must not be used as the production primary credential. |
| `NODE_ENV` | recommended | Set to `production` in any real deployment — it enables the `Secure` cookie flag and the strict CSP. |

Optional tracing/observability:

| Variable | Description |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Standard OTLP HTTP base endpoint for trace export. The OpenTelemetry exporter resolves the trace path. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional full trace-export endpoint, using the standard OpenTelemetry precedence rules. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Standard comma-separated `key=value` headers for authenticating to the trace backend. Never logged. |
| `REEF_RESPONSE_LOG` | Set to `1` to emit the per-request `response` access line (status + duration) and the backend `core` observability lines (LLM token usage) on stdout in **any** environment. On by default only in development. See the access-line policy below. |
| `REEF_SLOW_REQUEST_MS` | Threshold in milliseconds at/above which a `response` line is logged at WARN instead of INFO, so a slow request stands out. Defaults to `1000`; a non-positive or non-numeric value falls back to the default. |
| `LOG_LEVEL` | pino level for backend stdout logs (`debug`/`info`/`warn`/`error`). Defaults to `debug` in development and `info` otherwise. |
| `NEXT_PUBLIC_AKB_WEB_URL` | Public URL of the akb web app, used to open a linked akb document in a new tab from an issue. Optional; when unset that action is hidden. |

Per-user product secrets are intentionally **not** environment variables. Local
AKB credentials are carried by an httpOnly cookie; SSO token material stays in
encrypted Redis and its cookie is only an opaque handle. GitHub and LLM credentials are
deployment-managed server secrets, not browser storage. The three `REEF_LLM_*`
values must be set together; with none set, AI routes are unavailable but Reef,
AKB, and Keycloak flows remain ready.

### One-shot release CLI inputs

These inputs belong to the operator process, not the reef-web Deployment:

| Variable | Required | Description |
| --- | --- | --- |
| `REEF_CONTROL_PLANE_TOKEN` | register/deploy/resume | System-admin AKB credential. It is sent only in Core's Authorization header and is removed from child command environments. |
| `REGISTRY` | build/deploy | OCI image repository prefix, without a tag. The CLI pushes one unique build tag per image build and applies the returned digest; it never moves version/source aliases. |
| `REEF_APP_ID` | no | Previously recorded App Definition UUID. When set, the CLI reads it and verifies `app_key=reef` before registering a Release. |
| `REEF_BUILD_ARTIFACT` | register-only or optional deploy output | Path for the build identity artifact containing the repository, digest, full source revision, and root version. |
| `REEF_RELEASE_RECEIPT` | no | Path for the non-secret registration/rollout receipt used for handoff and request-key replay. |
| `REEF_ROLLOUT_REQUEST_KEY` | no | UUID idempotency key. Reuse it for a process retry of the same rollout input; resume requires a different UUID. |
| `REEF_ROLLOUT_DEADLINE_MS` / `REEF_ROLLOUT_POLL_MS` | no | Positive AKB observation bounds; defaults are 120000 ms and 1000 ms. |
| `REEF_KUBERNETES_TIMEOUT_MS` | no | Positive Kubernetes readiness timeout; defaults to 120000 ms. |

The CLI does not accept source revision or product-version overrides. The
committed Blueprint, clean `HEAD`, root version, build metadata, and immutable
digest must agree before AKB registration.

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
proxy) stays on in every environment, now stamped with the akb `actor` so an
error can be tied to a user (REEF-271). That actor is the **claimed** session
identity decoded from the cookie, not a verified one — reef-web is not the JWT
signing authority (akb is, and re-validates every forwarded request), so it is
reliable for akb-accepted requests and a best-effort hint on a forged cookie that
akb then rejects. It is a debug aid only, never used for authorization, and is
deliberately not emitted as the OTel `enduser.id` attribute (which denotes a
verified end user).

This leaves one gap: a deployment that runs **without a trace backend** would see
no response status/duration anywhere, and the richer backend signals (agent
lifecycle checkpoints, LLM token usage, upstream latency) — which are emitted as span
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
