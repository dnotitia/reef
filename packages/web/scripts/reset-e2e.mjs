#!/usr/bin/env node

const MOCK_URL = process.env.REEF_E2E_MOCK_URL ?? "http://127.0.0.1:7354";
const SCENARIO =
  process.argv.slice(2).find((arg) => arg !== "--") ??
  process.env.REEF_E2E_SCENARIO ??
  "configured";

if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(SCENARIO)) {
  process.stderr.write(
    `Invalid E2E fixture scenario: ${SCENARIO}. Use letters, numbers, underscores, and hyphens.\n`,
  );
  process.exit(1);
}

let response;
try {
  response = await fetch(`${MOCK_URL}/__e2e/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: SCENARIO }),
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `Failed to reach E2E fixture at ${MOCK_URL}: ${message}\n`,
  );
  process.exit(1);
}

if (!response.ok) {
  process.stderr.write(
    `Failed to reset E2E fixture (${response.status}): ${await response.text()}\n`,
  );
  process.exit(1);
}

const body = await response.json();
if (body?.ok !== true || body.scenario !== SCENARIO) {
  process.stderr.write(
    `Fixture rejected scenario "${SCENARIO}" (returned ${String(body?.scenario ?? "none")}).\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `Reset E2E fixture at ${MOCK_URL} to "${body.scenario}".\n`,
);
