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
  src/errors/index.test.ts \
  src/schemas/workspace/config.test.ts

pnpm --filter @reef/web exec vitest run \
  src/server/adapters/llmAdapter.test.ts \
  src/server/adapters/llmAdapter.wire.test.ts \
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
  src/server/adapters/llmConfig/serverConfig.test.ts

echo "== Reef hermetic account lifecycle =="
REEF_E2E_LLM_DISABLED=1 \
  pnpm --filter @reef/web run test:e2e:sharded --shards=1 \
  tests/e2e/auth/auth-sso-first.hermetic.spec.ts \
  tests/e2e/auth/auth-account-denial.hermetic.spec.ts \
  tests/e2e/workspace/workspace-vaults-hydration.hermetic.spec.ts

echo "ok: Reef workspace account and LLM capability governance"
