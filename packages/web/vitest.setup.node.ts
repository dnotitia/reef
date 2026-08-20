import { afterEach, beforeEach, vi } from "vitest";

// Keep a developer shell's compatibility aliases from leaking into otherwise
// hermetic tests; individual alias tests pass an explicit environment object.
beforeEach(() => {
  vi.stubEnv("REEF_AUTH_MODE", "local");
  for (const key of ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});
