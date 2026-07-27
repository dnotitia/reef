#!/usr/bin/env bash
#
# reef-web Kubernetes deploy — builds + pushes the image, then renders and
# applies a kustomize overlay.
#
# Required env:
#   REGISTRY      Docker registry to push to (e.g. ghcr.io/myorg or
#                 my-registry.local:5000). The image is tagged
#                 ${REGISTRY}/reef-web:latest and injected into the rendered
#                 manifests (overriding the base `reef-web:latest` reference).
#
# Optional env:
#   NAMESPACE     K8s namespace for the rollout commands (default: reef).
#                 Must match the namespace set by the overlay. The namespace
#                 is assumed to already exist and is NOT created here.
#   KUSTOMIZE_DIR Directory passed to `kubectl kustomize`. Defaults to the
#                 overlays/example overlay — copy it to your own overlay and
#                 point KUSTOMIZE_DIR at that.
#   PUBLIC_URL    Printed at the end. Cosmetic only — the actual host lives
#                 in the overlay's patch-ingress.yaml.
#   DEPLOY_VERSION
#                 Version recorded in rollout history (default: root package
#                 version prefixed with `v`).
#   DEPLOY_COMMIT Git commit recorded in rollout history (default: short HEAD).
#   CHANGE_CAUSE  Full rollout-history message. Overrides DEPLOY_VERSION and
#                 DEPLOY_COMMIT when set.

set -euo pipefail

: "${REGISTRY:?Set REGISTRY env (e.g. REGISTRY=ghcr.io/myorg)}"
NAMESPACE="${NAMESPACE:-reef}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KUSTOMIZE_DIR="${KUSTOMIZE_DIR:-${SCRIPT_DIR}/overlays/example}"
ROOT_DIR="${SCRIPT_DIR}/../.."
if [ -z "${CHANGE_CAUSE:-}" ]; then
  if [ -z "${DEPLOY_VERSION:-}" ]; then
    PACKAGE_VERSION="$(node -e \
      'process.stdout.write(require(process.argv[1]).version)' \
      "${ROOT_DIR}/package.json")"
    DEPLOY_VERSION="v${PACKAGE_VERSION}"
  fi
  DEPLOY_COMMIT="${DEPLOY_COMMIT:-$(git -C "${ROOT_DIR}" rev-parse --short=8 HEAD)}"
  CHANGE_CAUSE="Deploy reef-web ${DEPLOY_VERSION} (commit ${DEPLOY_COMMIT}) on $(date -u +%Y-%m-%d)"
fi

echo "=== Building Docker image (linux/amd64) ==="
docker buildx build --platform linux/amd64 \
  -t "${REGISTRY}/reef-web:latest" \
  -f "${ROOT_DIR}/Dockerfile" \
  --push \
  "${ROOT_DIR}"

echo "=== Applying manifests (kustomize: ${KUSTOMIZE_DIR}) ==="
# Inject the pushed image. This rewrites the base `reef-web:latest`
# reference; an overlay may instead pin the registry via an `images:`
# transformer (see overlays/example), in which case this is a no-op.
kubectl kustomize "${KUSTOMIZE_DIR}" | \
  sed "s|image: reef-web:latest|image: ${REGISTRY}/reef-web:latest|g" | \
  kubectl apply -f -

echo "=== Recording rollout provenance ==="
# Set this before restarting so the Deployment controller copies the
# annotation to the new ReplicaSet shown by `kubectl rollout history`.
kubectl annotate "deployment/reef-web" -n "${NAMESPACE}" \
  kubernetes.io/change-cause="${CHANGE_CAUSE}" --overwrite

echo "=== Rolling restart to pick up :latest image ==="
# `imagePullPolicy: Always` only pulls on pod creation; if the Deployment
# spec is unchanged k8s doesn't reschedule, so `:latest` edits silently
# no-op. Trigger a rollout so the new image is actually deployed.
kubectl rollout restart "deployment/reef-web" -n "${NAMESPACE}"

echo "=== Waiting for pods ==="
kubectl rollout status "deployment/reef-web" -n "${NAMESPACE}" --timeout=120s || echo "reef-web not ready yet"

echo ""
echo "=== Deployment complete ==="
[ -n "${PUBLIC_URL:-}" ] && echo "URL: ${PUBLIC_URL}"
echo "Status:"
kubectl get pods -n "${NAMESPACE}" -l app=reef-web
