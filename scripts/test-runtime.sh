#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_name="${1:-}"

usage() {
  printf '%s\n' \
    'Usage: scripts/test-runtime.sh <full-e2e|web-behavior|describe>' \
    '' \
    '  full-e2e     Install the pinned toolchain and run the full sharded web E2E gate.' \
    '  web-behavior Install the pinned toolchain and serve the hermetic browser runtime.' \
    '  describe     Print the repository-owned runtime catalog without executing it.'
}

if [[ "$runtime_name" == "describe" ]]; then
  printf '%s\n' \
    'full-e2e lifecycle=oneshot command=pnpm --filter @reef/web run test:e2e:sharded' \
    'web-behavior lifecycle=runtime command=pnpm --filter @reef/web run dev:e2e'
  exit 0
fi

if [[ "$runtime_name" != "full-e2e" && "$runtime_name" != "web-behavior" ]]; then
  usage >&2
  exit 2
fi

required_node="$(tr -d '\r\n' < "$repository_root/.node-version")"
if [[ ! "$required_node" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'invalid Node version in .node-version: %s\n' "$required_node" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux) node_platform=linux ;;
  Darwin) node_platform=darwin ;;
  *)
    printf 'unsupported Node platform: %s\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64|arm64) node_arch=arm64 ;;
  *)
    printf 'unsupported Node architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

node_distribution="node-v${required_node}-${node_platform}-${node_arch}"
cache_home="${XDG_CACHE_HOME:-$HOME/.cache}"
node_cache="$cache_home/reef-test-runtime/node"
node_root="$node_cache/$node_distribution"
install_lock="$node_cache/$node_distribution.installing"

node_is_ready() {
  [[ -x "$node_root/bin/node" ]] &&
    [[ "$($node_root/bin/node --version)" == "v$required_node" ]]
}

verify_archive() {
  local expected="$1"
  local archive="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
  elif command -v shasum >/dev/null 2>&1; then
    [[ "$(shasum -a 256 "$archive" | cut -d ' ' -f 1)" == "$expected" ]]
  else
    printf 'sha256sum or shasum is required\n' >&2
    return 1
  fi
}

install_node() (
  local install_root archive checksums expected
  install_root="$(mktemp -d "$node_cache/.install.XXXXXX")"
  archive="$install_root/$node_distribution.tar.gz"
  checksums="$install_root/SHASUMS256.txt"
  trap 'rm -rf "$install_root"' EXIT

  curl --fail --silent --show-error --location --retry 3 \
    --output "$archive" \
    "https://nodejs.org/dist/v${required_node}/${node_distribution}.tar.gz"
  curl --fail --silent --show-error --location --retry 3 \
    --output "$checksums" \
    "https://nodejs.org/dist/v${required_node}/SHASUMS256.txt"
  expected="$(while read -r digest filename; do
    if [[ "$filename" == "$node_distribution.tar.gz" ]]; then
      printf '%s' "$digest"
      break
    fi
  done < "$checksums")"
  if [[ -z "$expected" ]]; then
    printf 'Node checksum manifest has no entry for %s\n' "$node_distribution" >&2
    return 1
  fi
  verify_archive "$expected" "$archive"
  tar -xzf "$archive" -C "$install_root"
  [[ -x "$install_root/$node_distribution/bin/node" ]]
  rm -rf "$node_root"
  mv "$install_root/$node_distribution" "$node_root"
)

mkdir -p "$node_cache"
if ! node_is_ready; then
  if mkdir "$install_lock" 2>/dev/null; then
    trap 'rmdir "$install_lock" 2>/dev/null || true' EXIT
    if ! node_is_ready; then
      install_node
    fi
    rmdir "$install_lock"
    trap - EXIT
  else
    for _ in {1..300}; do
      if node_is_ready; then
        break
      fi
      sleep 1
    done
    if ! node_is_ready; then
      printf 'timed out waiting for the pinned Node installation\n' >&2
      exit 1
    fi
  fi
fi

export PATH="$node_root/bin:$PATH"
if [[ "$(node --version)" != "v$required_node" ]]; then
  printf 'Node runtime mismatch: expected v%s, found %s\n' "$required_node" "$(node --version)" >&2
  exit 1
fi

corepack_bin="$node_cache/corepack-bin"
mkdir -p "$corepack_bin"
corepack enable --install-directory "$corepack_bin"
export PATH="$corepack_bin:$PATH"

cd "$repository_root"
pnpm install --frozen-lockfile

case "$runtime_name" in
  full-e2e)
    exec pnpm --filter @reef/web run test:e2e:sharded
    ;;
  web-behavior)
    export REEF_WEB_URL="${REEF_WEB_URL:-http://localhost:7353}"
    export REEF_E2E_MOCK_URL="${REEF_E2E_MOCK_URL:-http://127.0.0.1:7354}"
    export REEF_E2E_SCENARIO="${REEF_E2E_SCENARIO:-configured}"
    runtime_root="${REEF_E2E_RUNTIME_ROOT:-${TMPDIR:-/tmp}/reef-e2e-runtime-$$}"
    mkdir -p "$runtime_root"
    export REEF_E2E_READY_FILE="${REEF_E2E_READY_FILE:-$runtime_root/ready.json}"
    exec pnpm --filter @reef/web run dev:e2e -- \
      --scenario "$REEF_E2E_SCENARIO" \
      --ready-file "$REEF_E2E_READY_FILE"
    ;;
esac
