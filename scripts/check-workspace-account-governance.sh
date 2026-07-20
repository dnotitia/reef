#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v pnpm >/dev/null 2>&1 || {
  echo "missing required command: pnpm" >&2
  exit 127
}

echo "== Reef account and configuration-derived LLM contract =="
pnpm --filter @reef/core exec vitest run \
  src/adapters/akb/core/http.test.ts \
  src/adapters/akb/workspace/auth.test.ts \
  src/adapters/llm.test.ts \
  src/adapters/llm.wire.test.ts \
  src/errors/index.test.ts \
  src/schemas/workspace/config.test.ts

pnpm --filter @reef/web exec vitest run \
  src/app/api/ai/managed-platform/route.test.ts \
  src/app/api/auth/akb/config/route.test.ts \
  src/app/api/auth/akb/login/route.test.ts \
  src/app/api/auth/akb/me/route.test.ts \
  src/app/api/auth/akb/sso/callback/route.test.ts \
  src/app/login/page.test.tsx \
  src/app/login/sso-complete/page.test.tsx \
  src/features/auth/hooks/useAuthRedirect.test.tsx \
  src/lib/akb/accountDenialClient.test.ts \
  src/lib/akb/checkAkbSession.test.ts \
  src/lib/api/requestHelpers.test.ts \
  src/lib/apiClient.test.ts \
  src/lib/llm/serverConfig.test.ts

echo "== Reef hermetic account lifecycle =="
pnpm --filter @reef/web build
mkdir -p \
  packages/web/.next/standalone/packages/web/.next/static \
  packages/web/.next/standalone/packages/web/public
cp -R packages/web/.next/static/. \
  packages/web/.next/standalone/packages/web/.next/static/
cp -R packages/web/public/. \
  packages/web/.next/standalone/packages/web/public/
REEF_E2E_LLM_DISABLED=1 \
  REEF_E2E_WEB_COMMAND='PORT={port} HOSTNAME=127.0.0.1 node .next/standalone/packages/web/server.js' \
  pnpm --filter @reef/web exec playwright test \
  tests/e2e/auth-sso-first.hermetic.spec.ts \
  tests/e2e/auth-account-denial.hermetic.spec.ts \
  tests/e2e/workspace-vaults-hydration.hermetic.spec.ts \
  --workers=1

echo "ok: Reef workspace account and LLM capability governance"
