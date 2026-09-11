#!/usr/bin/env bash
set -Eeuo pipefail

# Keep provisioning output away from the one stdout line reserved for the
# schema-v2 descriptor emitted by the Node supervisor.
exec 3>&1 1>&2

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${1:-}" != "serve" ]]; then
  echo "usage: $0 serve --scenario notifications-rbac [--runtime-root PATH] [--akb-checkout PATH]" >&2
  exit 2
fi

die() {
  echo "live notification runtime bootstrap failed: $*" >&2
  exit 1
}

ROOT_DIR="$(cd "$ROOT_DIR" && pwd -P)" || die "could not resolve the Reef checkout"

# The Crabbox job intentionally preflights only bash and git. Resolve the
# runtime root before parsing the version pins so every downloaded tool and
# cache is private to this invocation and outside the checkout.
RUNTIME_ROOT="${REEF_LIVE_NOTIFICATIONS_RUNTIME_ROOT:-}"
FORWARD_ARGS=("$@")
for ((index = 0; index < ${#FORWARD_ARGS[@]}; index += 1)); do
  case "${FORWARD_ARGS[index]}" in
    --runtime-root)
      ((index + 1 < ${#FORWARD_ARGS[@]})) || die "--runtime-root requires a path"
      RUNTIME_ROOT="${FORWARD_ARGS[index + 1]}"
      ((index += 1))
      ;;
  esac
done
if [[ -z "$RUNTIME_ROOT" ]]; then
  RUNTIME_ROOT="${TMPDIR:-/tmp}/reef-live-notifications-$$"
fi
mkdir -p -- "$RUNTIME_ROOT" || die "could not create runtime root"
RUNTIME_ROOT="$(cd "$RUNTIME_ROOT" && pwd -P)" || die "could not resolve runtime root"
case "$RUNTIME_ROOT/" in
  "$ROOT_DIR/"*) die "runtime root must be outside the Reef checkout" ;;
esac
chmod 700 -- "$RUNTIME_ROOT" || die "could not make runtime root private"

NODE_VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/.node-version")" || die "could not read .node-version"
[[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid Node version pin"
PNPM_VERSION="$(sed -nE 's/^[[:space:]]*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@([0-9]+\.[0-9]+\.[0-9]+)"[[:space:]]*,?[[:space:]]*$/\1/p' "$ROOT_DIR/package.json" | head -n 1)" || die "could not read packageManager"
[[ "$PNPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "packageManager must pin pnpm"

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH="arm64" ;;
  x86_64|amd64) NODE_ARCH="x64" ;;
  *) die "unsupported Linux architecture: $(uname -m)" ;;
esac

SYSTEM_NODE="$(command -v node 2>/dev/null || true)"
SYSTEM_NPM="$(command -v npm 2>/dev/null || true)"
SYSTEM_PNPM="$(command -v pnpm 2>/dev/null || true)"
SYSTEM_NODE_VERSION=""
SYSTEM_PNPM_VERSION=""
if [[ -n "$SYSTEM_NODE" ]]; then
  SYSTEM_NODE_VERSION="$($SYSTEM_NODE --version 2>/dev/null || true)"
fi
if [[ -n "$SYSTEM_PNPM" ]]; then
  SYSTEM_PNPM_VERSION="$($SYSTEM_PNPM --version 2>/dev/null || true)"
fi

TOOLCHAIN_ROOT="$RUNTIME_ROOT/toolchain"
NODE_HOME="$TOOLCHAIN_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
PNPM_HOME="$TOOLCHAIN_ROOT/pnpm"
NODE_BIN="$SYSTEM_NODE"
NPM_BIN="$SYSTEM_NPM"

# A matching system Node/npm pair is safe to reuse. Any missing or mismatched
# component is installed into the private runtime root; no host-wide Node or
# pnpm package is installed or changed.
NEEDS_PRIVATE_NODE=0
if [[ "$SYSTEM_NODE_VERSION" != "v$NODE_VERSION" || ! -x "$SYSTEM_NPM" ]]; then
  NEEDS_PRIVATE_NODE=1
fi

if (( NEEDS_PRIVATE_NODE == 1 )); then
  SUDO=()
  if [[ "$EUID" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || die "sudo is required to install download utilities"
    SUDO=(sudo)
  fi
  if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || die "apt-get is required for Ubuntu bootstrap utilities"
    "${SUDO[@]}" apt-get update >&2 || die "apt package index update failed"
    "${SUDO[@]}" apt-get install -y ca-certificates curl coreutils xz-utils >&2 \
      || die "download utility installation failed"
  fi
  mkdir -p -- "$TOOLCHAIN_ROOT" || die "could not create private toolchain root"
  chmod 700 -- "$TOOLCHAIN_ROOT"
  if [[ ! -x "$NODE_HOME/bin/node" || "$($NODE_HOME/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]]; then
    rm -rf -- "$NODE_HOME"
    mkdir -p -- "$NODE_HOME"
    NODE_ARCHIVE="$TOOLCHAIN_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    NODE_SHASUMS="$TOOLCHAIN_ROOT/SHASUMS256-${NODE_VERSION}.txt"
    NODE_DIST_URL="https://nodejs.org/dist/v${NODE_VERSION}"
    curl --fail --location --silent --show-error "$NODE_DIST_URL/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
      --output "$NODE_ARCHIVE" || die "Node.js ${NODE_VERSION} download failed"
    curl --fail --location --silent --show-error "$NODE_DIST_URL/SHASUMS256.txt" \
      --output "$NODE_SHASUMS" || die "Node.js ${NODE_VERSION} checksum download failed"
    EXPECTED_NODE_HASH="$(awk -v target="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" '$2 == target { print $1; exit }' "$NODE_SHASUMS")"
    [[ "$EXPECTED_NODE_HASH" =~ ^[0-9a-f]{64}$ ]] || die "Node.js checksum entry is missing"
    printf '%s  %s\n' "$EXPECTED_NODE_HASH" "$NODE_ARCHIVE" | sha256sum --check --status - \
      || die "Node.js ${NODE_VERSION} checksum verification failed"
    tar -xJf "$NODE_ARCHIVE" --strip-components=1 --directory "$NODE_HOME" \
      || die "Node.js ${NODE_VERSION} extraction failed"
  fi
  NODE_BIN="$NODE_HOME/bin/node"
  NPM_BIN="$NODE_HOME/bin/npm"
fi

[[ -x "$NODE_BIN" && -x "$NPM_BIN" ]] || die "pinned Node.js/npm are unavailable"
[[ "$($NODE_BIN --version)" == "v$NODE_VERSION" ]] || die "pinned Node.js version verification failed"

PNPM_BIN="$SYSTEM_PNPM"
if [[ "$SYSTEM_PNPM_VERSION" != "$PNPM_VERSION" || ! -x "$PNPM_BIN" ]]; then
  mkdir -p -- "$PNPM_HOME" || die "could not create private pnpm root"
  chmod 700 -- "$PNPM_HOME"
  "$NPM_BIN" install --global --prefix "$PNPM_HOME" --ignore-scripts --no-audit --no-fund \
    "pnpm@${PNPM_VERSION}" >&2 || die "pnpm ${PNPM_VERSION} installation failed"
  PNPM_BIN="$PNPM_HOME/bin/pnpm"
fi
[[ -x "$PNPM_BIN" ]] || die "pinned pnpm is unavailable"
[[ "$($PNPM_BIN --version)" == "$PNPM_VERSION" ]] || die "pinned pnpm version verification failed"

export PATH="$(dirname "$NODE_BIN"):$(dirname "$PNPM_BIN"):${PATH:-}"
export REEF_LIVE_NOTIFICATIONS_RUNTIME_ROOT="$RUNTIME_ROOT"
export REEF_LIVE_NOTIFICATIONS_NODE_BIN="$NODE_BIN"
export REEF_LIVE_NOTIFICATIONS_PNPM_BIN="$PNPM_BIN"

# Restore the caller's stdout only after all bootstrap output has been sent to
# stderr. The supervisor then owns stdout and emits exactly one ready JSON line.
exec 1>&3 3>&-
exec "$NODE_BIN" "$ROOT_DIR/scripts/ci/live-notifications-runtime.mjs" "${FORWARD_ARGS[@]}"
