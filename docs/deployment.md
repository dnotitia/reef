# Deploying reef

reef ships as a single stateless web service, **reef-web**, that talks to an
[akb](https://github.com/dnotitia/akb) backend. reef-web persists nothing of its
own: the akb session lives in an httpOnly cookie, the GitHub PAT for monitored
repos lives in the browser, and LLM config is deployment-managed server state.
That means deployment is just "run the container, point it at akb, give it an
OpenRouter key."

This guide covers three ways to run it:

1. [Build the image](#1-build-the-image)
2. [Kubernetes with kustomize](#2-kubernetes-with-kustomize) (recommended for clusters)
3. [Docker Compose](#3-docker-compose) (single host / local trial)

See [Required environment](#required-environment) for the full env contract.

---

## 1. Build the image

reef-web builds from the repo-root [`Dockerfile`](../Dockerfile) — a multi-stage
build (deps → builder → minimal runner) that emits the Next.js `standalone`
output and runs as a non-root user on port `3000`.

```bash
# From the repository root
docker build -t reef-web:latest .

# For a cluster, build for the node architecture and push to your registry
docker buildx build --platform linux/amd64 \
  -t ghcr.io/myorg/reef-web:latest \
  --push .
```

The container listens on `3000` and exposes a health endpoint at
`/api/healthz` (used by the Kubernetes liveness/readiness probes).

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
3. **akb backend + public origin** — `patch-config.yaml`:
   - `AKB_BACKEND_URL` — the in-cluster DNS of your akb backend Service, e.g.
     `http://backend.<akb-namespace>.svc.cluster.local:8000` (substitute your
     akb namespace and Service name).
   - `REEF_PUBLIC_ORIGIN` — reef-web's canonical external origin; it must match
     the ingress host below.
4. **Public host** — `patch-ingress.yaml` → the `tls.hosts` entry and
   `rules[].host`.

### Provide the OpenRouter secret

The Deployment pulls `OPENROUTER_API_KEY` from a Secret named `reef-web-secret`
in the same namespace. Create it once:

```bash
kubectl create secret generic reef-web-secret \
  --namespace my-namespace \
  --from-literal=OPENROUTER_API_KEY=sk-or-...
```

`OPENROUTER_BASE_URL` and `REEF_LLM_MODEL` are non-secret and live in the
ConfigMap (defaults are fine for OpenRouter).

### TLS

The base Ingress requests a certificate via a cert-manager `ClusterIssuer`
named `letsencrypt-prod` (annotation `cert-manager.io/cluster-issuer`). Change
the issuer name to match your cluster, or drop the annotation and supply the
`reef-web-tls` Secret yourself. The nginx SSE annotations
(`proxy-buffering: "off"`, long `proxy-read/send-timeout`) **must stay** — they
keep `/api/chat` token streaming working through the proxy.

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
`reef`; point them at your own overlay/namespace.

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
      # akb backend reef-web talks to (reachable from the container)
      AKB_BACKEND_URL: http://akb-backend:8000
      # reef-web's canonical external origin (bare scheme://host[:port]).
      # For local-only use over http this may be http://localhost:3000.
      REEF_PUBLIC_ORIGIN: https://reef.example.com
      # Deployment-managed LLM config
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY}
      OPENROUTER_BASE_URL: https://openrouter.ai/api/v1
      REEF_LLM_MODEL: deepseek/deepseek-v4-flash
```

```bash
OPENROUTER_API_KEY=sk-or-... docker compose up
```

reef-web is stateless, so there is no database or volume to manage. If your
akb backend runs in the same Compose project, give it a service name and use
that as the host in `AKB_BACKEND_URL` (e.g. `http://akb-backend:8000`).

---

## Required environment

reef-web reads its configuration from the process environment (in Kubernetes:
the `reef-web-config` ConfigMap plus the `reef-web-secret` Secret).

| Variable | Required | Description |
| --- | --- | --- |
| `AKB_BACKEND_URL` | yes | Base URL of the akb backend reef-web calls server-side. In-cluster this is a Service DNS name (`http://<service>.<namespace>.svc.cluster.local:8000`). |
| `REEF_PUBLIC_ORIGIN` | yes for SSO | reef-web's canonical external origin — bare `scheme://host[:port]`, no path. Sent to akb as the absolute SSO callback base so reef and akb's own frontend can share a tenant Keycloak. Must match the ingress/public host. `https` except for localhost dev. |
| `OPENROUTER_API_KEY` | yes for AI | OpenRouter API key for reef-web's AI routes. Keep it in a Secret; never inline it in manifests or commit it. |
| `OPENROUTER_BASE_URL` | no | OpenRouter API base. Defaults to `https://openrouter.ai/api/v1`. |
| `REEF_LLM_MODEL` | no | Model id passed to OpenRouter (e.g. `deepseek/deepseek-v4-flash`). |
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

Per-user secrets are intentionally **not** environment variables: the akb
session is an httpOnly cookie minted per request, and the GitHub PAT for
monitored repos lives only in the browser's IndexedDB.

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
no response status/duration anywhere, and the richer backend signals (activity-
scan checkpoints, LLM token usage, upstream latency) — which are emitted as span
attributes for the trace backend — would be invisible. For that case, set
`REEF_RESPONSE_LOG=1`. It turns on the stdout `response` access line **and** wires
the backend `core` observability lines, so the same data that would otherwise only
reach traces is also visible on stdout. Slow requests are promoted to WARN at the
`REEF_SLOW_REQUEST_MS` threshold so they stand out in that stream.

Credentials never reach any log: the proxy reads only the public actor claim from
the session cookie (never the token/PAT), credential headers are redacted by the
pino config, and typed API errors surface their upstream status/detail without the
nested request/response objects that carry credentials.
