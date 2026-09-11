#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${1:-}" != "serve" ]]; then
  echo "usage: $0 serve --scenario notifications-rbac [--runtime-root PATH] [--akb-checkout PATH]" >&2
  exit 2
fi

exec node "$ROOT_DIR/scripts/ci/live-notifications-runtime.mjs" "$@"
