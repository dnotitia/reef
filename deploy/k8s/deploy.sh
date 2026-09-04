#!/usr/bin/env bash
# Reef's one-shot release/deployment entrypoint. The Node CLI owns artifact
# identity, AKB registration/rollout, Kubernetes rendering, and readback.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/../.."
exec node "${ROOT_DIR}/scripts/release-deploy.mjs" "$@"
